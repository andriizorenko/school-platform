import http from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";

const port = Number(process.env.MONO_MOCK_PORT ?? 3100);
const expectedToken = process.env.MONO_TOKEN ?? "ci_mono_token";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const publicKeyBase64 = Buffer.from(publicPem).toString("base64");
let invoiceCounter = 0;
const invoices = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function bodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function authorized(req) {
  return req.headers["x-token"] === expectedToken;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/merchant/pubkey") {
    if (!authorized(req)) return json(res, 403, { errCode: "token_invalid" });
    return json(res, 200, { key: publicKeyBase64 });
  }

  if (req.method === "POST" && url.pathname === "/test/sign") {
    const raw = await bodyBuffer(req);
    const signer = createSign("SHA256");
    signer.update(raw);
    signer.end();
    return json(res, 200, { signature: signer.sign(privateKey).toString("base64") });
  }

  if (req.method === "POST" && url.pathname === "/api/merchant/invoice/create") {
    if (!authorized(req)) return json(res, 403, { errCode: "token_invalid" });
    const raw = await bodyBuffer(req);
    const payload = JSON.parse(raw.toString("utf8"));
    if (!Number.isInteger(payload.amount) || payload.amount <= 0) return json(res, 400, { errCode: "amount_invalid" });
    invoiceCounter += 1;
    const invoiceId = `mono_e2e_${invoiceCounter}`;
    invoices.set(invoiceId, { ...payload, invoiceId, cancels: [] });
    return json(res, 200, { invoiceId, pageUrl: `http://127.0.0.1:${port}/pay/${invoiceId}` });
  }

  if (req.method === "POST" && url.pathname === "/api/merchant/invoice/remove") {
    if (!authorized(req)) return json(res, 403, { errCode: "token_invalid" });
    const raw = await bodyBuffer(req);
    const payload = JSON.parse(raw.toString("utf8"));
    const invoice = invoices.get(payload.invoiceId);
    if (!invoice) return json(res, 404, { errCode: "invoice_not_found" });
    invoice.invalidated = true;
    res.writeHead(200);
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/api/merchant/invoice/cancel") {
    if (!authorized(req)) return json(res, 403, { errCode: "token_invalid" });
    const raw = await bodyBuffer(req);
    const payload = JSON.parse(raw.toString("utf8"));
    const invoice = invoices.get(payload.invoiceId);
    if (!invoice) return json(res, 404, { errCode: "invoice_not_found" });
    invoice.cancels.push(payload);
    const now = new Date().toISOString();
    return json(res, 200, { status: "processing", createdDate: now, modifiedDate: now });
  }

  if (req.method === "GET" && url.pathname.startsWith("/pay/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("mono E2E payment page mock");
  }

  json(res, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mono mock listening on http://127.0.0.1:${port}`);
});
