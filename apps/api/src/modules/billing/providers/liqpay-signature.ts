import { createHash, timingSafeEqual } from "node:crypto";

export function liqpaySignature(privateKey: string, data: string) {
  return createHash("sha3-256")
    .update(`${privateKey}${data}${privateKey}`, "utf8")
    .digest("base64");
}

export function encodeLiqPayData(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodeLiqPayData<T extends Record<string, unknown> = Record<string, unknown>>(data: string): T {
  const decoded = Buffer.from(data, "base64").toString("utf8");
  return JSON.parse(decoded) as T;
}

export function safeSignatureEquals(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
