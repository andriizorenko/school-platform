import assert from "node:assert/strict";
import test from "node:test";
import { decodeLiqPayData, encodeLiqPayData, liqpaySignature, safeSignatureEquals } from "./liqpay-signature";

test("LiqPay v7 signature uses SHA3-256 and round-trips payload", () => {
  const payload = { public_key: "i00000000", version: 7, action: "pay", amount: 3, currency: "UAH", order_id: "000001" };
  const data = encodeLiqPayData(payload);
  const signature = liqpaySignature("private-test-key", data);
  assert.equal(Buffer.from(signature, "base64").length, 32);
  assert.deepEqual(decodeLiqPayData(data), payload);
  assert.equal(safeSignatureEquals(signature, signature), true);
  assert.equal(safeSignatureEquals(signature, `${signature}x`), false);
});


test("LiqPay documentation SHA3-256 signature vector matches", () => {
  const privateKey = "a4825234f4bae72a0be04eafe9e8e2bada209255";
  const data = "eyJwdWJsaWNfa2V5IjoiaTAwMDAwMDAwIiwidmVyc2lvbiI6NywiYWN0aW9uIjoicGF5IiwiYW1vdW50IjoiMyIsImN1cnJlbmN5IjoiVUFIIiwiZGVzY3JpcHRpb24iOiJ0ZXN0Iiwib3JkZXJfaWQiOiIwMDAwMDEifQ==";
  assert.equal(liqpaySignature(privateKey, data), "0adgJ8F2Ds5HCVkcz4AlmdLMRoIJf7IxsL3QmeFRz/s=");
});
