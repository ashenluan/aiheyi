import { NextResponse } from "next/server";
import {
  fetchComfyUiStatus,
  getComfyUiConfig,
  getComfyUiConfigFilePath,
  resolveComfyUiServer,
  saveComfyUiConfig,
} from "@/app/lib/comfyui/serverConfig";
import type { ComfyUiServer } from "@/app/lib/comfyui/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleConnectionTest(body: Record<string, unknown>) {
  const platform = typeof body.platform === "string" ? body.platform : "";

  if (platform === "thirdparty" || typeof body.address === "string" || typeof body.url === "string") {
    const server = resolveComfyUiServer({
      serverId: typeof body.serverId === "string" ? body.serverId : null,
      url: typeof body.address === "string"
        ? body.address
        : typeof body.url === "string"
        ? body.url
        : null,
      name: typeof body.name === "string" ? body.name : "第三方算力服务器",
    });

    if (!server) {
      return NextResponse.json({ online: false, message: "未找到可用的第三方 ComfyUI 服务器" }, { status: 404 });
    }

    const status = await fetchComfyUiStatus(server);
    return NextResponse.json(
      {
        online: status.online,
        latencyMs: status.latencyMs,
        message: status.online ? "连接成功" : status.error || "服务器未响应",
      },
      { status: status.online ? 200 : 503 },
    );
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return NextResponse.json({ online: false, message: "请先填写 API Key" }, { status: 400 });
  }

  const looksValid = apiKey.length >= 16;
  const label = platform === "liblib" ? "LiblibAI" : "RunningHub";
  return NextResponse.json(
    {
      online: looksValid,
      message: looksValid
        ? `${label} API Key 已通过基础校验，可继续填写工作流 ID`
        : `${label} API Key 格式过短，请重新确认`,
    },
    { status: looksValid ? 200 : 400 },
  );
}

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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "test") {
      return handleConnectionTest(body);
    }

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
