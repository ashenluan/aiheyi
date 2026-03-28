#!/usr/bin/env node

const http = require("node:http");
const { createHmac } = require("node:crypto");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const SHARED_SECRET = (process.env.FEICAI_LICENSE_REMOTE_SHARED_SECRET || "FEICAI-STUDIO-SOURCE-AUTH-2026").trim();
const ALLOW_UNSIGNED = ["1", "true", "yes", "on"].includes(String(process.env.FEICAI_LICENSE_REMOTE_ALLOW_UNSIGNED || "").toLowerCase());

function normalizeCompact(value) {
  return String(value || "").replace(/-/g, "").trim().toUpperCase();
}

function buildActivationCode(machineCode, expiryStamp) {
  const prefix =
    createHmac("sha256", SHARED_SECRET)
      .update(`${String(machineCode).trim().toUpperCase()}|${String(expiryStamp).trim()}`)
      .digest("hex")
      .substring(0, 20)
      .toUpperCase()
      .match(/.{1,4}/g)
      .join("-");

  return `${prefix}-${String(expiryStamp).trim()}`;
}

function verifySignature(headers, body) {
  const timestamp = headers["x-license-timestamp"] || "";
  const nonce = headers["x-license-nonce"] || "";
  const signature = headers["x-license-signature"] || "";

  if (!signature) {
    return ALLOW_UNSIGNED;
  }

  const expected = createHmac("sha256", SHARED_SECRET)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");

  return expected === signature;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/verify") {
    return json(res, 404, { error: "Not found" });
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk.toString("utf8");
  });

  req.on("end", () => {
    if (!verifySignature(req.headers, raw)) {
      return json(res, 401, {
        valid: false,
        reason: "error",
        error: "请求签名无效",
      });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, {
        valid: false,
        reason: "invalid",
        error: "请求体不是合法 JSON",
      });
    }

    const activationCode = String(body.activationCode || "").trim().toUpperCase();
    const machineCodes = Array.isArray(body.machineCodes)
      ? body.machineCodes.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
      : [];

    if (!activationCode || machineCodes.length === 0) {
      return json(res, 400, {
        valid: false,
        reason: "invalid",
        error: "缺少 activationCode 或 machineCodes",
      });
    }

    const compact = normalizeCompact(activationCode);
    if (compact.length < 28) {
      return json(res, 200, {
        valid: false,
        reason: "invalid",
        error: "激活码格式无效",
      });
    }

    const expiryStamp = compact.slice(-8);
    const matchedMachineCode = machineCodes.find(
      (machineCode) => normalizeCompact(buildActivationCode(machineCode, expiryStamp)) === compact,
    );

    if (!matchedMachineCode) {
      return json(res, 200, {
        valid: false,
        reason: "invalid",
        error: "激活码无效，请检查是否输入正确",
      });
    }

    const expiry = `${expiryStamp.slice(0, 4)}-${expiryStamp.slice(4, 6)}-${expiryStamp.slice(6, 8)}`;
    const expiryDate = expiryStamp === "99991231"
      ? null
      : new Date(Number(expiryStamp.slice(0, 4)), Number(expiryStamp.slice(4, 6)) - 1, Number(expiryStamp.slice(6, 8)), 23, 59, 59);

    if (expiryDate && Date.now() > expiryDate.getTime()) {
      return json(res, 200, {
        valid: false,
        reason: "expired",
        matchedMachineCode,
        expiry,
        daysLeft: Math.ceil((expiryDate.getTime() - Date.now()) / 86400000),
        error: "授权已过期",
      });
    }

    return json(res, 200, {
      valid: true,
      matchedMachineCode,
      expiry,
      daysLeft: expiryStamp === "99991231"
        ? 9999
        : Math.ceil((expiryDate.getTime() - Date.now()) / 86400000),
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock remote license server listening on http://127.0.0.1:${PORT}/api/verify`);
  console.log(`allowUnsigned=${ALLOW_UNSIGNED ? "true" : "false"}`);
});
