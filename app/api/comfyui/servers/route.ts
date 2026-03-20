import { NextResponse } from "next/server";
import {
  getComfyUiConfig,
  getComfyUiConfigFilePath,
  saveComfyUiConfig,
} from "@/app/lib/comfyui/serverConfig";
import type { ComfyUiServer } from "@/app/lib/comfyui/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getComfyUiConfig();
    return NextResponse.json({
      ...config,
      configFile: getComfyUiConfigFilePath(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "读取 ComfyUI 配置失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const servers = Array.isArray(body.servers) ? (body.servers as ComfyUiServer[]) : [];
    const activeServerId = typeof body.activeServerId === "string" ? body.activeServerId : null;

    if (servers.length === 0) {
      return NextResponse.json({ error: "至少保留一个 ComfyUI 服务器" }, { status: 400 });
    }

    const config = saveComfyUiConfig({ servers, activeServerId });
    return NextResponse.json({
      ...config,
      configFile: getComfyUiConfigFilePath(),
      success: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "保存 ComfyUI 配置失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
