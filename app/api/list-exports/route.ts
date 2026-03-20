import { NextResponse } from "next/server";
import { getExportsDir, listSavedProjectBundles } from "@/app/lib/projectExchange";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const files = listSavedProjectBundles();
    return NextResponse.json({
      files,
      count: files.length,
      exportDir: getExportsDir(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
