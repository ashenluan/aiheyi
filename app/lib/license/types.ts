export type LicenseState =
  | "activated"
  | "unlicensed"
  | "expired"
  | "mismatch"
  | "invalid"
  | "error";

export interface LicenseStatus {
  activated: boolean;
  state: LicenseState;
  machineCode: string;
  expiry?: string;
  daysLeft?: number;
  error?: string;
  checkedAt: string;
}

export interface MachineFingerprintSnapshot {
  primaryMachineCode: string;
  candidateMachineCodes: string[];
}

export interface StoredLicenseRecord {
  activationCode: string;
  machineCode?: string;
}

export interface VerificationContext {
  activationCode: string;
  machineCodes: string[];
}

export interface VerificationResult {
  valid: boolean;
  matchedMachineCode?: string;
  expiry?: string;
  daysLeft?: number;
  reason?: Exclude<LicenseState, "activated" | "unlicensed">;
  error?: string;
}
