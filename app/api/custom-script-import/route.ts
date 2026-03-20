import { NextResponse } from "next/server";
import {
  appendPendingScript,
  clearPendingScripts,
  getPendingScriptsFilePath,
  readPendingScripts,
} from "@/app/lib/pendingScripts";

export const dynamic = "force-dynamic";

function buildCorsHeaders(request?: Request) {
  const origin = request?.headers?.get("origin") || "";
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "http://localhost:3000";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const pending = readPendingScripts();
    return NextResponse.json(
      { pending, filePath: getPendingScriptsFilePath(), count: pending.length },
      { headers: buildCorsHeaders(request) }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500, headers: buildCorsHeaders(request) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = String(body.title || body.name || "未命名剧本").trim();
    const content = String(body.content || body.script || body.text || "").trim();
    const desc = String(body.desc || body.description || "来自自定义导入").trim();
    const source = String(body.source || "custom-script-import").trim();

    if (!content) {
      return NextResponse.json(
        { error: "缺少剧本文本 content" },
        { status: 400, headers: buildCorsHeaders(request) }
      );
    }

    const entry = appendPendingScript({
      title,
      desc,
      content,
      source,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : undefined,
    });

    return NextResponse.json(
      {
        success: true,
        pending: entry,
        filePath: getPendingScriptsFilePath(),
        message: `剧本「${entry.title}」已加入待导入队列`,
      },
      { headers: buildCorsHeaders(request) }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500, headers: buildCorsHeaders(request) });
  }
}

export async function DELETE(request: Request) {
  try {
    clearPendingScripts();
    return NextResponse.json(
      { success: true, filePath: getPendingScriptsFilePath() },
      { headers: buildCorsHeaders(request) }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500, headers: buildCorsHeaders(request) });
  }
}
