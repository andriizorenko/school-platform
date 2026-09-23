import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decodeLiqPayData, encodeLiqPayData, liqpaySignature, safeSignatureEquals } from "./liqpay-signature";
import type { PaymentProviderAdapter, PaymentRefundInput } from "./payment-provider";

export type LiqPayCallbackPayload = {
  version?: number;
  public_key?: string;
  action?: string;
  amount?: number | string;
  currency?: string;
  description?: string;
  order_id?: string;
  payment_id?: number | string;
  liqpay_order_id?: string;
  paytype?: string;
  status?: string;
  refund_amount?: number | string;
  err_code?: string;
  err_description?: string;
  [key: string]: unknown;
};

export type LiqPayRefundResponse = {
  result?: string;
  status?: string;
  payment_id?: number | string;
  wait_amount?: boolean | string;
  err_code?: string;
  err_description?: string;
  [key: string]: unknown;
};

const API_VERSION = 7;

@Injectable()
export class LiqPayService implements PaymentProviderAdapter {
  constructor(private readonly config: ConfigService) {}

  readonly providerName = "LIQPAY" as const;

  isEnabled() {
    const explicit = this.config.get<string>("LIQPAY_ENABLED");
    if (explicit !== undefined) {
      return ["1", "true", "yes", "on"].includes(String(explicit).trim().toLowerCase());
    }
    return String(this.config.get<string>("PAYMENT_PROVIDER", "NONE")).toUpperCase() === "LIQPAY";
  }

  isReady() {
    return this.isEnabled() && Boolean(this.publicKey && this.privateKey && this.callbackUrl);
  }

  private get publicKey() {
    return this.config.get<string>("LIQPAY_PUBLIC_KEY", "").trim();
  }

  private get privateKey() {
    return this.config.get<string>("LIQPAY_PRIVATE_KEY", "").trim();
  }

  private get callbackUrl() {
    return this.config.get<string>("LIQPAY_CALLBACK_URL", "").trim();
  }

  private get resultUrl() {
    const configured = this.config.get<string>("LIQPAY_RESULT_URL", "").trim();
    return configured || `${this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "")}/parent/payments`;
  }

  private assertReady() {
    if (!this.isReady()) {
      throw new ServiceUnavailableException({
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
        message: "Online payment provider is not configured",
      });
    }
  }

  createCheckout(input: {
    orderId: string;
    amountMinor: number;
    currency: string;
    description: string;
    customerId?: string;
  }) {
    this.assertReady();
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException({ code: "PAYMENT_AMOUNT_INVALID", message: "Online payment amount must be positive" });
    }

    const separator = this.resultUrl.includes("?") ? "&" : "?";
    const payload: Record<string, unknown> = {
      version: API_VERSION,
      public_key: this.publicKey,
      action: "pay",
      amount: Number((input.amountMinor / 100).toFixed(2)),
      currency: input.currency.toUpperCase(),
      description: input.description,
      order_id: input.orderId,
      server_url: this.callbackUrl,
      result_url: `${this.resultUrl}${separator}order=${encodeURIComponent(input.orderId)}`,
      language: "uk",
    };
    if (input.customerId) payload.customer = input.customerId.slice(0, 100);

    const data = encodeLiqPayData(payload);
    return {
      provider: this.providerName,
      checkoutUrl: this.config.get<string>("LIQPAY_CHECKOUT_URL", "https://www.liqpay.ua/api/3/checkout"),
      method: "POST" as const,
      fields: {
        data,
        signature: liqpaySignature(this.privateKey, data),
      },
    };
  }

  verifyCallback(data: string, signature: string) {
    this.assertReady();
    const expected = liqpaySignature(this.privateKey, data);
    if (!safeSignatureEquals(expected, signature)) {
      throw new BadRequestException({ code: "LIQPAY_SIGNATURE_INVALID", message: "Invalid LiqPay callback signature" });
    }

    let payload: LiqPayCallbackPayload;
    try {
      payload = decodeLiqPayData<LiqPayCallbackPayload>(data);
    } catch {
      throw new BadRequestException({ code: "LIQPAY_DATA_INVALID", message: "Invalid LiqPay callback data" });
    }
    if (payload.public_key !== this.publicKey) {
      throw new BadRequestException({ code: "LIQPAY_PUBLIC_KEY_MISMATCH", message: "LiqPay callback belongs to another merchant" });
    }
    return payload;
  }

  async refund(input: PaymentRefundInput): Promise<LiqPayRefundResponse> {
    this.assertReady();
    const payload: Record<string, unknown> = {
      version: API_VERSION,
      public_key: this.publicKey,
      action: "refund",
      amount: Number((input.amountMinor / 100).toFixed(2)),
      order_id: input.orderId,
    };
    if (input.description) payload.description = input.description.slice(0, 500);

    const data = encodeLiqPayData(payload);
    const body = new URLSearchParams({ data, signature: liqpaySignature(this.privateKey, data) });
    const apiUrl = this.config.get<string>("LIQPAY_API_URL", "https://www.liqpay.ua/api/request");

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new BadGatewayException({
        code: "LIQPAY_UNREACHABLE",
        message: "LiqPay refund API is unavailable",
        details: { reason: error instanceof Error ? error.message : String(error) },
      });
    }

    const raw = await response.text();
    let parsed: LiqPayRefundResponse;
    try {
      parsed = JSON.parse(raw) as LiqPayRefundResponse;
    } catch {
      throw new BadGatewayException({
        code: "LIQPAY_RESPONSE_INVALID",
        message: "LiqPay returned an invalid refund response",
        details: { status: response.status },
      });
    }

    if (!response.ok) {
      throw new BadGatewayException({
        code: "LIQPAY_REFUND_HTTP_ERROR",
        message: "LiqPay refund request failed",
        details: { status: response.status, provider: parsed },
      });
    }
    return parsed;
  }
}
