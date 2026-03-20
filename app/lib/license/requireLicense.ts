import { NextResponse } from "next/server";

import { getSourceLicenseService, shouldBypassSourceLicense } from "./sourceLicenseService";

const UNLICENSED_MESSAGE = "软件未激活，请先完成授权激活";

export async function requireLicense() {
  try {
    if (shouldBypassSourceLicense()) {
      return null;
    }

    const status = await getSourceLicenseService().getStatus();
    if (status.activated) {
      return null;
    }

    return NextResponse.json(
      {
        error: UNLICENSED_MESSAGE,
        code: "UNLICENSED",
      },
      { status: 403 },
    );
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
