#!/usr/bin/env node

const { createHmac } = require("node:crypto");

const DEFAULT_LICENSE_SECRET = "FEICAI-STUDIO-SOURCE-AUTH-2026";
const PERMANENT_EXPIRY_STAMP = "99991231";

function normalizeMachineCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeExpiryStamp(value) {
  const normalized = String(value || PERMANENT_EXPIRY_STAMP).trim();
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error("expiry 必须是 YYYYMMDD，例如 20261231 或 99991231");
  }
  return normalized;
}

function getLicenseSecret() {
  return (process.env.FEICAI_LICENSE_SECRET || DEFAULT_LICENSE_SECRET).trim();
}

function buildActivationCode(machineCode, expiryStamp, secret = getLicenseSecret()) {
  const normalizedMachineCode = normalizeMachineCode(machineCode);
  const normalizedExpiry = normalizeExpiryStamp(expiryStamp);

  if (!/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(normalizedMachineCode)) {
    throw new Error("machineCode 格式必须是 XXXX-XXXX-XXXX-XXXX");
  }

  const prefix =
    createHmac("sha256", secret)
      .update(`${normalizedMachineCode}|${normalizedExpiry}`)
      .digest("hex")
      .substring(0, 20)
      .toUpperCase()
      .match(/.{1,4}/g)
      .join("-");

  return `${prefix}-${normalizedExpiry}`;
}

function printHelp() {
  console.log("用法:");
  console.log("  node scripts/generate-license-code.cjs <机器码> [到期日]");
  console.log("");
  console.log("示例:");
  console.log("  node scripts/generate-license-code.cjs F263-F4AB-7249-CF04 20261231");
  console.log("  node scripts/generate-license-code.cjs F263-F4AB-7249-CF04 99991231");
  console.log("");
  console.log("说明:");
  console.log("  到期日格式为 YYYYMMDD，99991231 表示长期授权。");
  console.log("  可通过 FEICAI_LICENSE_SECRET 覆盖默认签名密钥。");
}

function main() {
  const [, , machineCodeArg, expiryArg] = process.argv;

  if (!machineCodeArg || machineCodeArg === "-h" || machineCodeArg === "--help") {
    printHelp();
    process.exit(machineCodeArg ? 0 : 1);
  }

  const machineCode = normalizeMachineCode(machineCodeArg);
  const expiryStamp = normalizeExpiryStamp(expiryArg || PERMANENT_EXPIRY_STAMP);
  const activationCode = buildActivationCode(machineCode, expiryStamp);

  console.log(JSON.stringify({
    machineCode,
    expiryStamp,
    activationCode,
    secretSource: process.env.FEICAI_LICENSE_SECRET ? "env" : "default",
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
