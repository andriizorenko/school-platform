import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.LIQPAY_MOCK_PORT ?? 3099);
const privateKey = process.env.LIQPAY_PRIVATE_KEY ?? "";
const publicKey = process.env.LIQPAY_PUBLIC_KEY ?? "";
if (!privateKey || !publicKey) throw new Error("LIQPAY_PRIVATE_KEY and LIQPAY_PUBLIC_KEY are required");

function signature(data) {
  return createHash("sha3-256").update(`${privateKey}${data}${privateKey}`, "utf8").digest("base64");
}
function same(a, b) {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/request") {
    res.writeHead(404); res.end("not found"); return;
  }
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try {
      const form = new URLSearchParams(raw);
      const data = form.get("data") ?? "";
      const receivedSignature = form.get("signature") ?? "";
      if (!data || !receivedSignature || !same(signature(data), receivedSignature)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "error", err_code: "signature", err_description: "invalid signature" }));
        return;
      }
      const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
      if (payload.public_key !== publicKey || payload.version !== 7 || payload.action !== "refund") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "error", err_code: "payload", err_description: "unexpected payload" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: "ok", status: "reversed", payment_id: "e2e-refund-1", wait_amount: false }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: "error", err_description: error instanceof Error ? error.message : String(error) }));
    }
  });
});

server.listen(port, "127.0.0.1", () => console.log(`LiqPay E2E mock listening on 127.0.0.1:${port}`));
