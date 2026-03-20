import { createHmac } from "node:crypto";

import { MemoryLicenseCache } from "./licenseCache";
import { LicenseService } from "./licenseService";
import { DelegatingLicenseVerifier } from "./licenseVerifier";
import { LocalAppDataLicenseRepository } from "./licenseRepository";
import type { LicenseVerifier } from "./licenseVerifier";
import type { LicenseStatus } from "./types";

const DEFAULT_SOURCE_ACTIVATION_CODE = "SOURCE-ALPHA-STUDIO-20991231";
const DEFAULT_LICENSE_SECRET = "FEICAI-STUDIO-SOURCE-AUTH-2026";
const PERMANENT_EXPIRY_STAMP = "99991231";

let sourceLicenseService: LicenseService | null = null;

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function shouldBypassSourceLicense(): boolean {
  return isTruthyEnv(process.env.FEICAI_DEV_BYPASS_LICENSE);
}

export function buildBypassedSourceLicenseStatus(machineCode: string): LicenseStatus {
  return {
    activated: true,
    state: "activated",
    machineCode,
    expiry: "2099-12-31",
    daysLeft: 9999,
    checkedAt: new Date().toISOString(),
  };
}

function normalizeCompact(value: string): string {
  return value.replace(/-/g, "").trim().toUpperCase();
}

function extractExpiryStamp(activationCode: string): string | null {
  const compact = normalizeCompact(activationCode);
  if (compact.length < 28) {
    return null;
  }

  return compact.slice(-8);
}

function formatExpiry(stamp: string): string {
  if (stamp === PERMANENT_EXPIRY_STAMP) {
    return "永久授权";
  }

  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

function getExpiryDate(stamp: string): Date {
  return new Date(
    Number.parseInt(stamp.slice(0, 4), 10),
    Number.parseInt(stamp.slice(4, 6), 10) - 1,
    Number.parseInt(stamp.slice(6, 8), 10),
    23,
    59,
    59,
  );
}

function calculateDaysLeft(stamp: string, now = new Date()): number {
  if (stamp === PERMANENT_EXPIRY_STAMP) {
    return -1;
  }

  return Math.ceil((getExpiryDate(stamp).getTime() - now.getTime()) / 86_400_000);
}

function isExpired(stamp: string, now = new Date()): boolean {
  if (stamp === PERMANENT_EXPIRY_STAMP) {
    return false;
  }

  return now.getTime() > getExpiryDate(stamp).getTime();
}

function getLicenseSecret(): string {
  return (process.env.FEICAI_LICENSE_SECRET ?? DEFAULT_LICENSE_SECRET).trim();
}

function buildMachineBoundActivationCode(
  machineCode: string,
  expiryStamp: string,
  secret = getLicenseSecret(),
): string {
  const prefix =
    createHmac("sha256", secret)
      .update(`${machineCode}|${expiryStamp}`)
      .digest("hex")
      .substring(0, 20)
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join("-") ?? "";

  return `${prefix}-${expiryStamp}`;
}

function createSourceVerifier(): LicenseVerifier {
  return new DelegatingLicenseVerifier(({ activationCode, machineCodes }) => {
    const acceptedCode =
      (process.env.FEICAI_SOURCE_ACTIVATION_CODE ?? DEFAULT_SOURCE_ACTIVATION_CODE)
        .trim()
        .toUpperCase();

    if (activationCode !== acceptedCode) {
      const expiryStamp = extractExpiryStamp(activationCode);
      if (!expiryStamp) {
        return {
          valid: false,
          reason: "invalid",
          error: "激活码格式无效",
        };
      }

      const now = new Date();
      const matchedMachineCode = machineCodes.find(
        (machineCode) =>
          normalizeCompact(
            buildMachineBoundActivationCode(machineCode, expiryStamp),
          ) === normalizeCompact(activationCode),
      );

      if (!matchedMachineCode) {
        return {
          valid: false,
          reason: "invalid",
          error: "激活码无效，请检查是否输入正确",
        };
      }

      if (isExpired(expiryStamp, now)) {
        return {
          valid: false,
          reason: "expired",
          matchedMachineCode,
          expiry: formatExpiry(expiryStamp),
          daysLeft: calculateDaysLeft(expiryStamp, now),
          error: `授权已于 ${formatExpiry(expiryStamp)} 过期`,
        };
      }

      return {
        valid: true,
        matchedMachineCode,
        expiry: formatExpiry(expiryStamp),
        daysLeft: calculateDaysLeft(expiryStamp, now),
      };
    }

    return {
      valid: true,
      matchedMachineCode: machineCodes[0],
      expiry: "2099-12-31",
      daysLeft: 9999,
    };
  });
}

export function getSourceLicenseService(): LicenseService {
  if (!sourceLicenseService) {
    const repositoryDirectory =
      process.env.FEICAI_LICENSE_DIR ??
      process.env.FEICAI_SOURCE_LICENSE_DIR ??
      "FEICAI-Studio";

    sourceLicenseService = new LicenseService({
      repository: new LocalAppDataLicenseRepository(repositoryDirectory),
      verifier: createSourceVerifier(),
      cache: new MemoryLicenseCache(),
    });
  }

  return sourceLicenseService;
}

export function getDefaultSourceActivationCode(): string {
  return (process.env.FEICAI_SOURCE_ACTIVATION_CODE ?? DEFAULT_SOURCE_ACTIVATION_CODE)
    .trim()
    .toUpperCase();
}

export function buildSourceMachineActivationCode(
  machineCode: string,
  expiryStamp = PERMANENT_EXPIRY_STAMP,
): string {
  return buildMachineBoundActivationCode(machineCode.trim().toUpperCase(), expiryStamp);
}
