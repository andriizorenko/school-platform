import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  PaymentCheckout,
  PaymentCheckoutInput,
  PaymentProviderAdapter,
  PaymentRefundInput,
  PaymentRefundResponse,
} from "./payment-provider";
import { verifyMonoWebhookSignature } from "./mono-signature";

export type MonoCancelItem = {
  status?: string;
  amount?: number;
  ccy?: number;
  createdDate?: string;
  modifiedDate?: string;
  approvalCode?: string;
  rrn?: string;
  extRef?: string;
};

export type MonoWebhookPayload = {
  invoiceId?: string;
  status?: string;
  amount?: number;
  ccy?: number;
  finalAmount?: number;
  createdDate?: string;
  modifiedDate?: string;
  reference?: string;
  destination?: string;
  errCode?: string;
  failureReason?: string;
  paymentInfo?: {
    paymentMethod?: string;
    [key: string]: unknown;
  };
  cancelList?: MonoCancelItem[];
  [key: string]: unknown;
};

type MonoInvoiceResponse = {
  invoiceId?: string;
  pageUrl?: string;
  appUrl?: string;
  [key: string]: unknown;
};

type MonoRefundResponse = {
  status?: string;
  createdDate?: string;
  modifiedDate?: string;
  [key: string]: unknown;
};

@Injectable()
export class MonoService implements PaymentProviderAdapter {
  readonly providerName = "MONO" as const;
  private cachedPublicKeyBase64: string | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    const explicit = this.config.get<string>("MONO_ENABLED");
    if (explicit !== undefined) return this.booleanValue(explicit);
    const legacy = String(this.config.get<string>("PAYMENT_PROVIDER", "NONE")).trim().toUpperCase();
    return legacy === "MONO";
  }

  isReady() {
    return this.isEnabled() && Boolean(this.token && this.webhookUrl);
  }

  private booleanValue(value: unknown) {
    return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
  }

  private get token() {
    return this.config.get<string>("MONO_TOKEN", "").trim();
  }

  private get webhookUrl() {
    return this.config.get<string>("MONO_WEBHOOK_URL", "").trim();
  }

  private get resultUrl() {
    const configured = this.config.get<string>("MONO_RESULT_URL", "").trim();
    return configured || `${this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "")}/parent/payments`;
  }

  private get apiBaseUrl() {
    return this.config.get<string>("MONO_API_URL", "https://api.monobank.ua").trim().replace(/\/$/, "");
  }

  private get configuredPublicKey() {
    return this.config.get<string>("MONO_WEBHOOK_PUBLIC_KEY_BASE64", "").trim();
  }

  private assertReady() {
    if (!this.isReady()) {
      throw new ServiceUnavailableException({
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
        message: "Monobank acquiring is not configured",
      });
    }
  }

  async createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckout> {
    this.assertReady();
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException({ code: "PAYMENT_AMOUNT_INVALID", message: "Online payment amount must be positive" });
    }
    if (input.currency.toUpperCase() !== "UAH") {
      throw new BadRequestException({ code: "MONO_CURRENCY_UNSUPPORTED", message: "Monobank checkout currently supports UAH orders only" });
    }

    const separator = this.resultUrl.includes("?") ? "&" : "?";
    const payload = {
      amount: input.amountMinor,
      ccy: 980,
      merchantPaymInfo: {
        reference: input.orderId,
        destination: input.description.slice(0, 280),
      },
      redirectUrl: `${this.resultUrl}${separator}order=${encodeURIComponent(input.orderId)}`,
      webHookUrl: this.webhookUrl,
      paymentType: "debit",
    };

    const parsed = await this.postJson<MonoInvoiceResponse>("/api/merchant/invoice/create", payload, "MONO_CREATE_INVOICE_FAILED");
    if (!parsed.invoiceId || !parsed.pageUrl) {
      throw new BadGatewayException({
        code: "MONO_RESPONSE_INVALID",
        message: "Monobank returned an invalid invoice response",
        details: parsed,
      });
    }

    return {
      provider: this.providerName,
      checkoutUrl: parsed.pageUrl,
      method: "GET",
      providerPaymentId: parsed.invoiceId,
    };
  }

  async cancelCheckout(providerPaymentId: string) {
    this.assertReady();
    if (!providerPaymentId) return;
    await this.postEmpty("/api/merchant/invoice/remove", { invoiceId: providerPaymentId }, "MONO_INVALIDATE_INVOICE_FAILED");
  }

  async refund(input: PaymentRefundInput): Promise<PaymentRefundResponse> {
    this.assertReady();
    if (!input.providerPaymentId) {
      throw new BadRequestException({ code: "MONO_INVOICE_ID_MISSING", message: "Monobank invoice id is missing for this payment" });
    }
    const payload: Record<string, unknown> = {
      invoiceId: input.providerPaymentId,
      amount: input.amountMinor,
    };
    if (input.idempotencyKey) payload.extRef = input.idempotencyKey;

    return this.postJson<MonoRefundResponse>("/api/merchant/invoice/cancel", payload, "MONO_REFUND_FAILED");
  }

  async verifyWebhook(rawBody: Buffer, signatureBase64: string | undefined) {
    this.assertReady();
    if (!signatureBase64) {
      throw new BadRequestException({ code: "MONO_SIGNATURE_MISSING", message: "Monobank webhook x-sign header is required" });
    }

    let key = await this.publicKey(false);
    if (verifyMonoWebhookSignature(key, rawBody, signatureBase64)) return true;

    // Official guidance allows caching the key and refreshing only when verification stops working.
    if (!this.configuredPublicKey) {
      key = await this.publicKey(true);
      if (verifyMonoWebhookSignature(key, rawBody, signatureBase64)) return true;
    }

    throw new BadRequestException({ code: "MONO_SIGNATURE_INVALID", message: "Invalid Monobank webhook signature" });
  }

  private async publicKey(forceRefresh: boolean) {
    if (!forceRefresh && this.cachedPublicKeyBase64) return this.cachedPublicKeyBase64;

    const configured = this.configuredPublicKey;
    if (configured) {
      const decoded = Buffer.from(configured, "base64").toString("utf8");
      if (!decoded.includes("BEGIN PUBLIC KEY")) {
        throw new ServiceUnavailableException({ code: "MONO_PUBLIC_KEY_INVALID", message: "Configured Monobank public key is invalid" });
      }
      this.cachedPublicKeyBase64 = configured;
      return this.cachedPublicKeyBase64;
    }

    const response = await this.fetchMono("/api/merchant/pubkey", { method: "GET" }, "MONO_PUBLIC_KEY_UNAVAILABLE");
    const parsed = await this.readJson<{ key?: string }>(response, "MONO_PUBLIC_KEY_INVALID_RESPONSE");
    if (!parsed.key) {
      throw new BadGatewayException({ code: "MONO_PUBLIC_KEY_INVALID_RESPONSE", message: "Monobank public-key response has no key" });
    }
    this.cachedPublicKeyBase64 = parsed.key;
    return this.cachedPublicKeyBase64;
  }

  private async postEmpty(path: string, payload: Record<string, unknown>, errorCode: string) {
    await this.fetchMono(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, errorCode);
  }

  private async postJson<T extends Record<string, unknown>>(path: string, payload: Record<string, unknown>, errorCode: string) {
    const response = await this.fetchMono(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, errorCode);
    return this.readJson<T>(response, `${errorCode}_INVALID_RESPONSE`);
  }

  private async fetchMono(path: string, init: RequestInit, errorCode: string) {
    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          "X-Token": this.token,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new BadGatewayException({
        code: "MONO_UNREACHABLE",
        message: "Monobank acquiring API is unavailable",
        details: { reason: error instanceof Error ? error.message : String(error) },
      });
    }

    if (!response.ok) {
      const raw = await response.text();
      let details: unknown = raw;
      try { details = JSON.parse(raw); } catch {}
      throw new BadGatewayException({
        code: errorCode,
        message: "Monobank acquiring request failed",
        details: { status: response.status, provider: details },
      });
    }
    return response;
  }

  private async readJson<T>(response: Response, code: string): Promise<T> {
    const raw = await response.text();
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new BadGatewayException({ code, message: "Monobank returned invalid JSON", details: { status: response.status } });
    }
  }
}
