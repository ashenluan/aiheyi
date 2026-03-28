import { NextRequest, NextResponse } from "next/server";

import {
  addFlowExtensionTasks,
  buildFlowStatus,
  clearFlowExtensionTasks,
  deleteFlowExtensionTask,
  getStoredFlowCookie,
  hideFlowImages,
  listFlowImages,
  loadFlowExtensionTasks,
  loadFlowUpsampleTasks,
  markFlowExtensionTaskCopied,
  openFlowInBrowser,
  queueFlowUpsampleTask,
  rememberFlowCookieCheck,
  saveFlowImageFromSource,
  updateFlowUpsampleTask,
  updateStoredFlowCookie,
  validateFlowCookie,
} from "@/app/lib/flowStore";
import { requireLicense } from "@/app/lib/license/requireLicense";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function extractGeneratedImages(data: Record<string, unknown>) {
  const candidates: Array<{ imageData?: string; imageUrl?: string }> = [];
  const append = (value: unknown) => {
    if (typeof value !== "string") return;
    if (value.startsWith("data:")) {
      candidates.push({ imageData: value });
      return;
    }
    if (value.startsWith("http://") || value.startsWith("https://")) {
      candidates.push({ imageUrl: value });
    }
  };

  append(data.image);
  append(data.url);
  append(data.imageUrl);

  if (Array.isArray(data.images)) {
    for (const item of data.images) {
      if (typeof item === "string") append(item);
      else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        append(record.url);
        append(record.imageUrl);
        append(record.image);
      }
    }
  }

  if (Array.isArray(data.results)) {
    for (const item of data.results) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        append(record.url);
        append(record.imageUrl);
        append(record.image);
      }
    }
  }

  return candidates;
}

async function handleDirectGenerate(request: NextRequest, body: Record<string, unknown>) {
  const prompt = asString(body.prompt || body.text);
  if (!prompt) {
    return NextResponse.json({ error: "缺少 prompt" }, { status: 400 });
  }

  const apiKey = asString(body.apiKey || body.imageApiKey || body.flowApiKey);
  const baseUrl = asString(body.baseUrl || body.imageBaseUrl || body.flowBaseUrl);
  const model = asString(body.model || body.imageModel || body.flowModel);

  if (!apiKey || !baseUrl || !model) {
    return NextResponse.json(
      { error: "缺少 Flow 直连配置，请补齐 apiKey / baseUrl / model，或改用扩展模式" },
      { status: 400 },
    );
  }

  const payload = {
    apiKey,
    baseUrl,
    model,
    prompt,
    referenceImages: asStringArray(body.referenceImages || body.images),
    referenceLabels: asStringArray(body.referenceLabels),
    imageSize: asString(body.imageSize || body.targetSize) || "1K",
    aspectRatio: asString(body.aspectRatio) || "16:9",
    format: asString(body.format) || "gemini",
  };

  const response = await fetch(new URL("/api/image", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  const images = extractGeneratedImages(data);
  const saved = [];
  for (const item of images) {
    saved.push(
      await saveFlowImageFromSource({
        imageData: item.imageData,
        imageUrl: item.imageUrl,
        prefix: `flow-${payload.imageSize}`,
      }),
    );
  }

  if (saved.length > 0 && body.autoUpsample) {
    const targetSize = asString(body.autoUpsample).toUpperCase() === "4K" ? "4K" : "2K";
    for (const item of saved) {
      queueFlowUpsampleTask({ imageKey: item.key, filename: item.filename, targetSize });
    }
  }

  return NextResponse.json({
    success: true,
    mode: "http",
    engine: "builtin",
    images: saved,
    raw: data,
  });
}

export async function GET(request: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  const action = request.nextUrl.searchParams.get("action") || "status";

  switch (action) {
    case "list-images":
      return NextResponse.json({ images: await listFlowImages() });
    case "extension-tasks":
      return NextResponse.json({ tasks: loadFlowExtensionTasks() });
    case "extension-task-detail": {
      const taskId = request.nextUrl.searchParams.get("taskId") || "";
      const task = loadFlowExtensionTasks().find((item) => item.id === taskId);
      return task
        ? NextResponse.json(task)
        : NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    case "pending-upsample":
      return NextResponse.json({
        tasks: loadFlowUpsampleTasks().filter((task) => task.status === "pending" || task.status === "processing"),
      });
    case "upsample-status": {
      const taskId = request.nextUrl.searchParams.get("taskId") || "";
      const tasks = loadFlowUpsampleTasks();
      if (!taskId) return NextResponse.json({ tasks });
      const task = tasks.find((item) => item.id === taskId);
      return task
        ? NextResponse.json(task)
        : NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    case "credits":
      return NextResponse.json({ supported: false, credits: null, message: "当前源码版暂未接入 Flow 积分查询" });
    default:
      return NextResponse.json(buildFlowStatus());
  }
}

export async function POST(request: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = asString(body.action) || request.nextUrl.searchParams.get("action") || "status";

    switch (action) {
      case "submit-extension-task": {
        const tasks = Array.isArray(body.tasks)
          ? body.tasks
          : Array.isArray(body.items)
            ? body.items
            : [body];
        const created = addFlowExtensionTasks(tasks as Array<Record<string, unknown>>);
        return NextResponse.json({ success: true, tasks: created });
      }
      case "mark-task-copied": {
        const taskId = asString(body.taskId || body.id);
        if (!taskId) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
        markFlowExtensionTaskCopied(taskId);
        return NextResponse.json({ success: true, taskId });
      }
      case "clear-extension-tasks":
        clearFlowExtensionTasks();
        return NextResponse.json({ success: true });
      case "delete-extension-task": {
        const taskId = asString(body.taskId || body.id);
        if (!taskId) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
        deleteFlowExtensionTask(taskId);
        return NextResponse.json({ success: true, taskId });
      }
      case "request-upsample": {
        const imageKey = asString(body.imageKey || body.key);
        if (!imageKey) return NextResponse.json({ error: "缺少 imageKey" }, { status: 400 });
        const task = queueFlowUpsampleTask({
          imageKey,
          filename: asString(body.filename),
          targetSize: asString(body.targetSize).toUpperCase() === "4K" ? "4K" : "2K",
        });
        return NextResponse.json({ success: true, task });
      }
      case "upsample-result": {
        const taskId = asString(body.taskId || body.id);
        if (!taskId) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
        let outputKey = asString(body.outputKey);
        if (asString(body.imageData) || asString(body.imageUrl || body.url)) {
          const saved = await saveFlowImageFromSource({
            imageData: asString(body.imageData),
            imageUrl: asString(body.imageUrl || body.url),
            prefix: `flow-${asString(body.targetSize || "up")}`,
          });
          outputKey = saved.key;
        }
        const task = updateFlowUpsampleTask(taskId, {
          status: asString(body.status) === "error" ? "error" : "done",
          outputKey: outputKey || undefined,
          error: asString(body.error) || undefined,
        });
        return NextResponse.json({ success: true, task });
      }
      case "receive-download":
      case "receive-image": {
        const saved = await saveFlowImageFromSource({
          filename: asString(body.filename),
          imageData: asString(body.imageData || body.data),
          imageUrl: asString(body.imageUrl || body.downloadUrl || body.url),
          prefix: action === "receive-download" ? "flow-ext" : "flow",
        });
        return NextResponse.json({ success: true, ...saved });
      }
      case "generate":
      case "refine":
        return handleDirectGenerate(request, body);
      case "caption":
        return NextResponse.json({ success: true, caption: asString(body.prompt || body.text || body.caption) });
      case "clear-images": {
        const filename = asString(body.filename);
        hideFlowImages(filename ? [filename] : undefined);
        return NextResponse.json({ success: true, filename: filename || null });
      }
      case "test-cookie": {
        const cookie = asString(body.cookie) || getStoredFlowCookie();
        if (asString(body.cookie)) updateStoredFlowCookie(cookie);
        const result = await validateFlowCookie(cookie);
        rememberFlowCookieCheck(result.ok, result.message);
        return NextResponse.json({
          success: result.ok,
          valid: result.ok,
          hasCookie: Boolean(cookie),
          checkedAt: new Date().toISOString(),
          message: result.message,
        });
      }
      case "status":
      case "stop":
        return NextResponse.json({
          ...buildFlowStatus(),
          message: action === "stop" ? "Flow HTTP 无常驻进程需要停止" : undefined,
        });
      case "open-flow": {
        const opened = openFlowInBrowser();
        return NextResponse.json({ success: true, url: "https://labs.google/fx/zh/tools/flow", ...opened });
      }
      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 },
    );
  }
}
