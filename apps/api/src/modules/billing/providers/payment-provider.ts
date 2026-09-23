export type PaymentProviderName = "LIQPAY" | "MONO";

export type PaymentCheckout = {
  provider: PaymentProviderName;
  checkoutUrl: string;
  method: "GET" | "POST";
  fields?: Record<string, string>;
  providerPaymentId?: string;
};

export type PaymentCheckoutInput = {
  orderId: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerId?: string;
};

export type PaymentRefundInput = {
  orderId: string;
  providerPaymentId?: string | null;
  amountMinor: number;
  idempotencyKey?: string | null;
  description?: string;
};

export type PaymentRefundResponse = Record<string, unknown>;

export interface PaymentProviderAdapter {
  readonly providerName: PaymentProviderName;
  isReady(): boolean;
  createCheckout(input: PaymentCheckoutInput): PaymentCheckout | Promise<PaymentCheckout>;
  cancelCheckout?(providerPaymentId: string): Promise<void>;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResponse>;
}
