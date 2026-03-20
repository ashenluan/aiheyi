import { NextResponse } from "next/server";
import {
  getExportsDir,
  importProjectBundle,
  readSavedProjectBundle,
  type ProjectExportBundle,
} from "@/app/lib/projectExchange";

export const dynamic = "force-dynamic";

function extractBundle(body: unknown): ProjectExportBundle | null {
  if (!body || typeof body !== "object") return null;
  if ((body as { format?: string }).format === "feicai-project-export") {
    return body as ProjectExportBundle;
  }
  if ((body as { bundle?: unknown }).bundle && typeof (body as { bundle?: unknown }).bundle === "object") {
    const nested = (body as { bundle: unknown }).bundle;
    if ((nested as { format?: string }).format === "feicai-project-export") {
      return nested as ProjectExportBundle;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fromFile = typeof body.fileName === "string" ? body.fileName : "";
    const bundle = fromFile ? readSavedProjectBundle(fromFile) : extractBundle(body);

    if (!bundle) {
      return NextResponse.json({ error: "缺少有效的导入数据 bundle" }, { status: 400 });
    }

    const result = importProjectBundle(bundle, {
      preserveId: body.preserveId !== false,
      overwrite: body.overwrite === true,
    });

    return NextResponse.json({
      success: true,
      projectId: result.projectId,
      metadataPath: result.metadataPath,
      importedFiles: result.importedFiles,
      exportDir: getExportsDir(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
