import { NextResponse } from "next/server";
import {
  getExportsDir,
  loadProjectBundleFromDisk,
  saveProjectBundle,
} from "@/app/lib/projectExchange";
import { getHotUpdateStatus } from "@/app/lib/hotUpdate";

export const dynamic = "force-dynamic";

function jsonAttachment(body: string, fileName: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const download = searchParams.get("download") === "1";

    if (!projectId) {
      return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const hotUpdate = await getHotUpdateStatus();
    const bundle = loadProjectBundleFromDisk(projectId, hotUpdate.currentVersion);
    if (download) {
      const fileName = `${String(bundle.project.name || projectId).replace(/[<>:\"/\\\\|?*]+/g, "_") || projectId}.json`;
      return jsonAttachment(JSON.stringify(bundle, null, 2), fileName);
    }

    return NextResponse.json({
      bundle,
      exportDir: getExportsDir(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    if (!projectId) {
      return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    }

    const hotUpdate = await getHotUpdateStatus();
    const bundle = loadProjectBundleFromDisk(projectId, hotUpdate.currentVersion);
    const saved = saveProjectBundle(bundle, typeof body.fileName === "string" ? body.fileName : undefined);

    return NextResponse.json({
      success: true,
      fileName: saved.fileName,
      filePath: saved.filePath,
      size: saved.size,
      exportDir: getExportsDir(),
      bundle,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
