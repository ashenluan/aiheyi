import { createHmac, randomUUID } from "node:crypto";

import type {
  LicenseState,
  VerificationContext,
  VerificationResult,
} from "./types";
import type { LicenseVerifier } from "./licenseVerifier";

interface RemoteVerifierOptions {
  endpoint: string;
  appId?: string;
  sharedSecret?: string;
  timeoutMs?: number;
}

interface RemoteVerifyRequest {
  appId: string;
  activationCode: string;
  machineCodes: string[];
  timestamp: string;
  nonce: string;
}

interface RemoteVerifyResponse {
  valid: boolean;
  matchedMachineCode?: string;
  expiry?: string;
  daysLeft?: number;
  reason?: Exclude<LicenseState, "activated" | "unlicensed">;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_APP_ID = "aiheyi-desktop";

function normalizeReason(value: unknown): RemoteVerifyResponse["reason"] {
  if (
    value === "expired" ||
    value === "mismatch" ||
    value === "invalid" ||
    value === "error"
  ) {
    return value;
  }
  return undefined;
}

function signRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
}

function mapRemoteResponse(data: unknown): VerificationResult {
  const payload = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const valid = payload.valid === true;
  return {
    valid,
    matchedMachineCode:
      typeof payload.matchedMachineCode === "string" ? payload.matchedMachineCode : undefined,
    expiry: typeof payload.expiry === "string" ? payload.expiry : undefined,
    daysLeft: typeof payload.daysLeft === "number" ? payload.daysLeft : undefined,
    reason: normalizeReason(payload.reason),
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}

export class RemoteLicenseVerifier implements LicenseVerifier {
  private readonly endpoint: string;
  private readonly appId: string;
  private readonly sharedSecret?: string;
  private readonly timeoutMs: number;

  constructor(options: RemoteVerifierOptions) {
    this.endpoint = options.endpoint.trim();
    this.appId = (options.appId || DEFAULT_APP_ID).trim();
    this.sharedSecret = options.sharedSecret?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const requestBody: RemoteVerifyRequest = {
      appId: this.appId,
      activationCode: context.activationCode,
      machineCodes: context.machineCodes,
      timestamp,
      nonce,
    };

    const body = JSON.stringify(requestBody);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-license-app-id": this.appId,
      "x-license-timestamp": timestamp,
      "x-license-nonce": nonce,
    };

    if (this.sharedSecret) {
      headers["x-license-signature"] = signRequest(this.sharedSecret, timestamp, nonce, body);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    const result = mapRemoteResponse(data);

    if (!response.ok) {
      return {
        valid: false,
        reason: result.reason ?? "error",
        error: result.error || `远程授权校验失败 (${response.status})`,
        matchedMachineCode: result.matchedMachineCode,
        expiry: result.expiry,
        daysLeft: result.daysLeft,
      };
    }

    return result;
  }
}

export function shouldUseRemoteLicenseVerifier(): boolean {
  return Boolean(process.env.FEICAI_LICENSE_REMOTE_URL?.trim());
}

export function getRemoteLicenseVerifier(): RemoteLicenseVerifier {
  const endpoint = process.env.FEICAI_LICENSE_REMOTE_URL?.trim();
  if (!endpoint) {
    throw new Error("未配置 FEICAI_LICENSE_REMOTE_URL");
  }

  const timeoutValue = Number.parseInt(process.env.FEICAI_LICENSE_REMOTE_TIMEOUT_MS || "", 10);

  return new RemoteLicenseVerifier({
    endpoint,
    appId: process.env.FEICAI_LICENSE_REMOTE_APP_ID,
    sharedSecret: process.env.FEICAI_LICENSE_REMOTE_SHARED_SECRET,
    timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : undefined,
  });
}
