/**
 * GET /api/seedance/health
 * 健康检查
 */

import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";

export async function GET() {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  return NextResponse.json({
    status: "ok",
    mode: "direct-jimeng-api",
    timestamp: Date.now(),
  });
}
