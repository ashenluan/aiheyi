import { NextResponse } from "next/server";

import { requireActivatedSourceLicense } from "./licenseGuard";

export async function requireLicense() {
  try {
    return await requireActivatedSourceLicense();
  } catch {
    return NextResponse.json(
      {
        error: "授权验证失败",
        code: "LICENSE_ERROR",
      },
      { status: 500 },
    );
  }
}
