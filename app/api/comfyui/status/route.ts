import { NextResponse } from "next/server";
import {
  fetchComfyUiStatus,
  resolveComfyUiServer,
} from "@/app/lib/comfyui/serverConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildStatusResponse(input?: {
  serverId?: string | null;
  url?: string | null;
  name?: string | null;
}) {
  const server = resolveComfyUiServer(input);
  if (!server) {
    return NextResponse.json({ error: "未找到可用的 ComfyUI 服务器" }, { status: 404 });
  }

  const status = await fetchComfyUiStatus(server);
  return NextResponse.json(status, { status: status.online ? 200 : 503 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return buildStatusResponse({
    serverId: searchParams.get("serverId"),
    url: searchParams.get("url"),
    name: searchParams.get("name"),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return buildStatusResponse({
      serverId: typeof body.serverId === "string" ? body.serverId : null,
      url: typeof body.url === "string" ? body.url : null,
      name: typeof body.name === "string" ? body.name : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ComfyUI 状态检查失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
