import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { resolveComfyUiServer } from "@/app/lib/comfyui/serverConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseWorkflow(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workflow = parseWorkflow(body.workflow);

    if (!workflow || Object.keys(workflow).length === 0) {
      return NextResponse.json({ error: "请提供有效的 ComfyUI workflow JSON" }, { status: 400 });
    }

    const server = resolveComfyUiServer({
      serverId: typeof body.serverId === "string" ? body.serverId : null,
      url: typeof body.url === "string" ? body.url : null,
      name: typeof body.name === "string" ? body.name : null,
    });

    if (!server) {
      return NextResponse.json({ error: "未找到可用的 ComfyUI 服务器" }, { status: 404 });
    }

    const clientId = typeof body.clientId === "string" && body.clientId.trim()
      ? body.clientId.trim()
      : `feicai-source-${randomUUID()}`;
    const payload = {
      prompt: workflow,
      client_id: clientId,
      extra_data: typeof body.extraData === "object" && body.extraData
        ? body.extraData
        : {
            extra_pnginfo: {
              source: "合一漫剧 Source",
              module: "comfyui",
            },
          },
    };

    let response: Response;
    try {
      response = await fetch(`${server.url}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知错误";
      return NextResponse.json(
        {
          success: false,
          serverId: server.id,
          serverName: server.name,
          url: server.url,
          clientId,
          workflowNodes: Object.keys(workflow).length,
          error: `无法连接到 ComfyUI 服务器：${message}`,
        },
        { status: 503 }
      );
    }

    const rawText = await response.text();
    let parsed: Record<string, unknown> = {};
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = { rawText };
      }
    }

    if (!response.ok) {
      const message =
        typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
          ? parsed.message
          : `ComfyUI 返回 ${response.status}`;

      return NextResponse.json(
        {
          success: false,
          serverId: server.id,
          serverName: server.name,
          url: server.url,
          clientId,
          workflowNodes: Object.keys(workflow).length,
          rawResponse: parsed,
          error: message,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      serverId: server.id,
      serverName: server.name,
      url: server.url,
      clientId,
      promptId:
        (parsed.prompt_id as string | undefined) ||
        (parsed.promptId as string | undefined) ||
        "",
      workflowNodes: Object.keys(workflow).length,
      rawResponse: parsed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ComfyUI 工作流提交失败";
    return NextResponse.json({ error: message, success: false }, { status: 500 });
  }
}
