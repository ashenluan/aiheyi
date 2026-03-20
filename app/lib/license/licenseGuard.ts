import { NextResponse } from "next/server";

import { getSourceLicenseService, shouldBypassSourceLicense } from "./sourceLicenseService";
import type { LicenseStatus } from "./types";

export const DEFAULT_UNLICENSED_MESSAGE = "软件未激活，请先完成授权激活";
export const DEFAULT_UNLICENSED_CODE = "UNLICENSED";

export interface LicenseGuardOptions {
  error?: string;
  code?: string;
  status?: number;
}

export interface UnlicensedPayload {
  error: string;
  code: string;
  licenseStatus: LicenseStatus;
}

export async function getEffectiveLicenseStatus(): Promise<LicenseStatus> {
  return getSourceLicenseService().getStatus();
}

export function createUnlicensedResponse(
  licenseStatus: LicenseStatus,
  options: LicenseGuardOptions = {},
) {
  return NextResponse.json(
    {
      error: options.error ?? DEFAULT_UNLICENSED_MESSAGE,
      code: options.code ?? DEFAULT_UNLICENSED_CODE,
      licenseStatus,
    },
    { status: options.status ?? 403 },
  );
}

export async function requireActivatedSourceLicense(
  options: LicenseGuardOptions = {},
) {
  if (shouldBypassSourceLicense()) {
    return null;
  }

  const licenseStatus = await getEffectiveLicenseStatus();
  if (licenseStatus.activated) {
    return null;
  }

  return createUnlicensedResponse(licenseStatus, options);
}
