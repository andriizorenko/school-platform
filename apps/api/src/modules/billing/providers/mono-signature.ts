import { createVerify } from "node:crypto";

export function verifyMonoWebhookSignature(publicKeyBase64: string, rawBody: Buffer, signatureBase64: string) {
  try {
    const publicKeyPem = Buffer.from(publicKeyBase64, "base64");
    const signature = Buffer.from(signatureBase64, "base64");
    if (!publicKeyPem.length || !signature.length) return false;
    const verifier = createVerify("SHA256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKeyPem, signature);
  } catch {
    return false;
  }
}
