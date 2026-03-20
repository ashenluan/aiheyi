import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveProjectFile } from "@/app/lib/runtimePaths";

export const dynamic = "force-dynamic";

// POST: Set config and scripts for testing
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "import-script") {
      // Read a script file from the project root
      const { filename } = body;
      // Sanitize: only allow basename to prevent path traversal
      const safeFilename = path.basename(String(filename || ""));
      const filePath = resolveProjectFile(safeFilename);
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: `File not found: ${filename}` }, { status: 404 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json({ content, filename });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
