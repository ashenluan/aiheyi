import type { VerificationContext, VerificationResult } from "./types";

export interface LicenseVerifier {
  verify(context: VerificationContext): Promise<VerificationResult>;
}

export type VerificationHandler = (
  context: VerificationContext,
) => Promise<VerificationResult> | VerificationResult;

export function normalizeActivationCode(value: string): string {
  return value.trim().toUpperCase();
}

export class DelegatingLicenseVerifier implements LicenseVerifier {
  constructor(private readonly handler: VerificationHandler) {}

  async verify(context: VerificationContext): Promise<VerificationResult> {
    return this.handler(context);
  }
}
