import { NextResponse } from "next/server";

import { requireLicense } from "@/app/lib/license/requireLicense";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BASE = "https://api.geeknow.top";
const DEFAULT_MODEL = "sora-2";
const VIDEO_PROMPT =
  "Generate a short smooth video that showcases this subject clearly with gentle motion";

interface Img2CharRequest {
  apiKey?: string;
  baseUrl?: string;
  imageData?: string;
  category?: "character" | "scene" | "prop";
  nickname?: string;
  model?: string;
}

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function imageSourceToBase64(imageData: string): Promise<string> {
  if (imageData.startsWith("data:")) {
    const match = imageData.match(/^data:[^;]+;base64,(.+)$/);
    if (match) return match[1];
    throw new Error("无效的 data URL 格式");
  }

  if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
    const response = await fetch(imageData, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`图片下载失败 (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  }

  throw new Error("无效的图片格式（需要 data URL 或 http URL）");
}

async function submitVideoTask(
  baseUrl: string,
  apiKey: string,
  imageBase64: string,
  model: string,
) {
  const endpoint = `${baseUrl}/v1/videos`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: VIDEO_PROMPT,
      seconds: "5",
      size: "1280x720",
      input_reference: imageBase64,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`视频提交失败 (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const taskId =
    (data.id as string | undefined) ||
    (data.task_id as string | undefined) ||
    (data.taskId as string | undefined) ||
    ((data.data as Record<string, unknown> | undefined)?.id as string | undefined) ||
    "";
  const videoUrl =
    (data.video_url as string | undefined) ||
    (data.videoUrl as string | undefined) ||
    ((data.data as Record<string, unknown> | undefined)?.video_url as string | undefined) ||
    "";

  if (videoUrl) {
    return { videoUrl, taskId };
  }

  if (!taskId) {
    throw new Error("视频 API 未返回 task_id，请检查模型和 API Key");
  }

  const pollEndpoint = `${baseUrl}/v1/videos/${taskId}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    try {
      const pollResponse = await fetch(pollEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!pollResponse.ok) continue;

      const pollData = (await pollResponse.json()) as Record<string, unknown>;
      const nested = (pollData.data as Record<string, unknown> | undefined) || {};
      const status = String(pollData.status || nested.status || "").toLowerCase();

      if (["failed", "failure", "error", "cancelled"].includes(status)) {
        const message =
          (pollData.error as string | undefined) ||
          (pollData.message as string | undefined) ||
          "视频生成失败";
        throw new Error(message);
      }

      if (["completed", "succeeded", "success", "done"].includes(status)) {
        const resolvedVideoUrl =
          (pollData.video_url as string | undefined) ||
          (pollData.videoUrl as string | undefined) ||
          (pollData.video as string | undefined) ||
          (nested.video_url as string | undefined) ||
          (nested.url as string | undefined) ||
          (pollData.url as string | undefined) ||
          "";

        if (resolvedVideoUrl) {
          return { videoUrl: resolvedVideoUrl, taskId };
        }

        const deepMatch = JSON.stringify(pollData).match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
        if (deepMatch) {
          return { videoUrl: deepMatch[1], taskId };
        }

        throw new Error("视频生成成功但未找到 URL");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("失败") || error.message.includes("URL"))
      ) {
        throw error;
      }
    }
  }

  throw new Error("视频生成超时（10分钟未完成）");
}

async function extractCharacter(
  baseUrl: string,
  apiKey: string,
  videoUrl: string,
  taskId?: string,
) {
  const endpoint = `${baseUrl}/sora/v1/characters`;
  const payload: Record<string, string> = { timestamps: "1,3" };
  if (taskId) payload.from_task = taskId;
  else payload.url = videoUrl;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`角色提取失败 (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const id = data.id as string | undefined;
  const username = data.username as string | undefined;
  if (!id || !username) {
    throw new Error(`角色提取响应无效: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    id,
    username,
    profilePicture: (data.profile_picture_url as string | undefined) || "",
    permalink: (data.permalink as string | undefined) || "",
  };
}

export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Img2CharRequest;
    const apiKey = String(body.apiKey || "").trim();
    const imageData = String(body.imageData || "").trim();
    const baseUrl = trimBaseUrl(String(body.baseUrl || DEFAULT_BASE).trim() || DEFAULT_BASE);
    const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const category = String(body.category || "character").trim() || "character";
    const nickname = String(body.nickname || "").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "缺少 apiKey" }, { status: 400 });
    }
    if (!imageData) {
      return NextResponse.json({ error: "缺少参考图" }, { status: 400 });
    }

    let imageBase64: string;
    try {
      imageBase64 = await imageSourceToBase64(imageData);
    } catch (error) {
      return NextResponse.json(
        {
          error: `图片处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
          step: "upload",
        },
        { status: 500 },
      );
    }

    let videoResult: { videoUrl: string; taskId: string };
    try {
      videoResult = await submitVideoTask(baseUrl, apiKey, imageBase64, model);
    } catch (error) {
      return NextResponse.json(
        {
          error: `视频生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
          step: "video",
        },
        { status: 500 },
      );
    }

    let character;
    try {
      character = await extractCharacter(baseUrl, apiKey, videoResult.videoUrl, videoResult.taskId);
    } catch (error) {
      return NextResponse.json(
        {
          error: `角色提取失败: ${error instanceof Error ? error.message : "未知错误"}`,
          step: "character",
          videoUrl: videoResult.videoUrl,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: character.id,
      username: character.username,
      profile_picture_url: character.profilePicture,
      permalink: character.permalink,
      videoUrl: videoResult.videoUrl,
      taskId: videoResult.taskId,
      category,
      nickname,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `服务端错误: ${message}` }, { status: 500 });
  }
}
