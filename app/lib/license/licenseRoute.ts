import { NextResponse } from "next/server";

import {
  buildBypassedSourceLicenseStatus,
  getSourceLicenseService,
  shouldBypassSourceLicense,
} from "./sourceLicenseService";

interface ActivationPayload {
  activationCode?: unknown;
}

export function createSourceLicenseRouteHandlers() {
  const licenseService = getSourceLicenseService();

  return {
    async GET() {
      const status = await licenseService.getStatus();
      if (shouldBypassSourceLicense()) {
        return NextResponse.json(buildBypassedSourceLicenseStatus(status.machineCode));
      }

      return NextResponse.json(status);
    },

    async POST(request: Request) {
      let payload: ActivationPayload;

      try {
        payload = (await request.json()) as ActivationPayload;
      } catch {
        return NextResponse.json(
          {
            activated: false,
            state: "invalid",
            error: "请求体必须是 JSON",
          },
          { status: 400 },
        );
      }

      if (typeof payload.activationCode !== "string") {
        const status = await licenseService.getStatus();
        return NextResponse.json(
          {
            ...status,
            activated: false,
            state: "invalid",
            error: "缺少 activationCode",
          },
          { status: 400 },
        );
      }

      const status = await licenseService.getStatus();
      if (shouldBypassSourceLicense()) {
        return NextResponse.json(buildBypassedSourceLicenseStatus(status.machineCode));
      }

      const activationStatus = await licenseService.activate(payload.activationCode);
      return NextResponse.json(activationStatus, {
        status: activationStatus.activated ? 200 : 400,
      });
    },
  };
}
