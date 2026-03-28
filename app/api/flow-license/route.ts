import { NextResponse } from "next/server";

import {
  buildBypassedSourceLicenseStatus,
  getSourceLicenseService,
  shouldBypassSourceLicense,
} from "@/app/lib/license/sourceLicenseService";

export const dynamic = "force-dynamic";

const licenseService = getSourceLicenseService();

export async function GET() {
  const status = await licenseService.getStatus();
  const payload = shouldBypassSourceLicense()
    ? buildBypassedSourceLicenseStatus(status.machineCode)
    : status;

  return NextResponse.json({
    machineCode: payload.machineCode,
    status: payload,
  });
}

export async function POST(request: Request) {
  let payload: { activationCode?: unknown };

  try {
    payload = (await request.json()) as { activationCode?: unknown };
  } catch {
    const status = await licenseService.getStatus();
    return NextResponse.json(
      {
        machineCode: status.machineCode,
        status: {
          ...status,
          activated: false,
          state: "invalid",
          error: "请求体必须是 JSON",
        },
      },
      { status: 400 },
    );
  }

  const currentStatus = await licenseService.getStatus();
  if (shouldBypassSourceLicense()) {
    const bypassed = buildBypassedSourceLicenseStatus(currentStatus.machineCode);
    return NextResponse.json({ machineCode: bypassed.machineCode, status: bypassed });
  }

  if (typeof payload.activationCode !== "string") {
    return NextResponse.json(
      {
        machineCode: currentStatus.machineCode,
        status: {
          ...currentStatus,
          activated: false,
          state: "invalid",
          error: "缺少 activationCode",
        },
      },
      { status: 400 },
    );
  }

  const activationStatus = await licenseService.activate(payload.activationCode);
  return NextResponse.json(
    {
      machineCode: activationStatus.machineCode,
      status: activationStatus,
    },
    { status: activationStatus.activated ? 200 : 400 },
  );
}
