import { NextRequest, NextResponse } from "next/server";

import { requireLicense } from "@/app/lib/license/requireLicense";
import { applyHotUpdate, getHotUpdateStatus } from "@/app/lib/hotUpdate";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) {
    return blocked;
  }

  try {
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    return NextResponse.json(await getHotUpdateStatus({ checkRemote: refresh }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) {
    return blocked;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      patchUrl?: string;
      sha256?: string;
      remoteVersion?: string;
    };

    return NextResponse.json(await applyHotUpdate(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = /缺少更新参数|不允许的更新源/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
