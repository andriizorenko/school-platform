import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LiqPayService } from "./liqpay.service";
import { MonoService } from "./mono.service";
import type { PaymentProviderAdapter, PaymentProviderName } from "./payment-provider";

@Injectable()
export class PaymentProvidersService {
  constructor(
    private readonly config: ConfigService,
    private readonly liqpay: LiqPayService,
    private readonly mono: MonoService,
  ) {}

  readyProviders(): PaymentProviderName[] {
    return [this.mono, this.liqpay].filter((provider) => provider.isReady()).map((provider) => provider.providerName);
  }

  defaultProvider(): PaymentProviderName | null {
    const ready = this.readyProviders();
    if (!ready.length) return null;
    const configured = String(
      this.config.get<string>("PAYMENT_DEFAULT_PROVIDER", this.config.get<string>("PAYMENT_PROVIDER", "")),
    ).trim().toUpperCase();
    if (configured === "MONO" && ready.includes("MONO")) return "MONO";
    if (configured === "LIQPAY" && ready.includes("LIQPAY")) return "LIQPAY";
    return ready[0];
  }

  resolve(name?: string | null): PaymentProviderAdapter {
    const normalized = String(name || this.defaultProvider() || "").trim().toUpperCase();
    const provider = normalized === "MONO" ? this.mono : normalized === "LIQPAY" ? this.liqpay : null;
    if (!provider || !provider.isReady()) {
      throw new BadRequestException({
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        message: "Selected payment provider is not available",
        details: { provider: normalized || null, availableProviders: this.readyProviders() },
      });
    }
    return provider;
  }
}
