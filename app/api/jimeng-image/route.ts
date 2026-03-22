/**
 * 即梦生图 API 路由
 * POST /api/jimeng-image — 生成图片 / 查询任务状态 / 图片库操作
 * GET  /api/jimeng-image — 获取图片库图片（磁盘读取）
 */

import { NextRequest, NextResponse } from "next/server";
import { getBaseOutputDir } from "@/app/lib/paths";
import { requireLicense } from "@/app/lib/license/requireLicense";
import {
  createTaskId,
  getTask,
  setTask,
  deleteTask,
  generateJimengImage,
  diagnoseBrowserProxy,
} from "@/app/lib/jimeng-image/api";
import type {
  JimengImageModelId,
  JimengImageRatio,
  JimengImageResolution,
  JimengImageTask,
} from "@/app/lib/jimeng-image/types";
import fs from "fs";
import path from "path";

type JimengHistoryTaskRecord = {
  taskId?: string;
  label?: string;
  model?: string;
  resolution?: string;
  images?: string[];
  startTime?: number;
  endTime?: number;
};

type JimengPageBatchRecord = {
  id?: string;
  taskId?: string;
  prompt?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  styleSummary?: string;
  stylePromptSummary?: string;
  status?: string;
  startTime?: number;
  results?: Array<{ url?: string }>;
};

type JimengLibraryFileMeta = {
  sourceType?: "history" | "page";
  taskId?: string;
  batchId?: string;
  label?: string;
  model?: string;
  resolution?: string;
  ratio?: string;
  prompt?: string;
  promptPreview?: string;
  styleSummary?: string;
  stylePromptSummary?: string;
  generatedAt?: number;
};

/** 获取输出目录 */
function getOutputDir(): string {
  return getBaseOutputDir();
}

/** 图片库目录 */
function getJimengImagesDir(): string {
  const dir = path.join(getOutputDir(), "jimeng-images");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function extractJimengKeyFromUrl(input?: string | null): string | null {
  if (!input) return null;
  try {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/jimeng-image") {
      return url.searchParams.get("key");
    }
  } catch {
    // ignore
  }
  return null;
}

function buildHistoryMetaMap(): Map<string, JimengLibraryFileMeta> {
  const meta = new Map<string, JimengLibraryFileMeta>();
  const tasks = readJsonFile<JimengHistoryTaskRecord[]>(path.join(getOutputDir(), "jimeng-task-history.json"));
  if (!Array.isArray(tasks)) return meta;

  for (const task of tasks) {
    const images = Array.isArray(task.images) ? task.images : [];
    for (const imageUrl of images) {
      const key = extractJimengKeyFromUrl(imageUrl);
      if (!key) continue;
      meta.set(key, {
        sourceType: "history",
        taskId: task.taskId,
        label: task.label,
        model: task.model,
        resolution: task.resolution,
        generatedAt: task.endTime || task.startTime,
      });
    }
  }
  return meta;
}

function buildPageStateMetaMap(): Map<string, JimengLibraryFileMeta> {
  const meta = new Map<string, JimengLibraryFileMeta>();
  const state = readJsonFile<{ batches?: JimengPageBatchRecord[] }>(path.join(getOutputDir(), "jimeng-page-state.json"));
  const batches = Array.isArray(state?.batches) ? state?.batches : [];

  for (const batch of batches) {
    if (batch.status && batch.status !== "done") continue;
    const results = Array.isArray(batch.results) ? batch.results : [];
    for (const result of results) {
      const key = extractJimengKeyFromUrl(result?.url);
      if (!key) continue;
      const prompt = typeof batch.prompt === "string" ? batch.prompt.trim() : "";
      meta.set(key, {
        sourceType: "page",
        batchId: batch.id,
        taskId: batch.taskId,
        model: batch.model,
        resolution: batch.resolution,
        ratio: batch.ratio,
        prompt,
        promptPreview: prompt ? prompt.slice(0, 120) : undefined,
        styleSummary: typeof batch.styleSummary === "string" ? batch.styleSummary : undefined,
        stylePromptSummary: typeof batch.stylePromptSummary === "string" ? batch.stylePromptSummary : undefined,
        generatedAt: batch.startTime,
      });
    }
  }
  return meta;
}

// ═══════════════════════════════════════════════════════════
// GET — 读取图片库文件 或 列出图片
// ═══════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  const { searchParams } = req.nextUrl;
  const key = searchParams.get("key");
  const list = searchParams.get("list");

  if (list === "1") {
    // 列出所有图片
    const dir = getJimengImagesDir();
    try {
      const historyMeta = buildHistoryMetaMap();
      const pageMeta = buildPageStateMetaMap();
      const files = fs.readdirSync(dir)
        .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map(f => {
          const stat = fs.statSync(path.join(dir, f));
          const key = f.replace(/\.[^.]+$/, "");
          const page = pageMeta.get(key);
          const history = historyMeta.get(key);
          const merged = {
            ...history,
            ...page,
          };
          const searchText = [
            f,
            key,
            merged.label,
            merged.model,
            merged.resolution,
            merged.ratio,
            merged.styleSummary,
            merged.stylePromptSummary,
            merged.promptPreview,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return {
            key,
            filename: f,
            size: stat.size,
            createdAt: stat.mtimeMs,
            ...merged,
            searchText,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      return NextResponse.json({ files });
    } catch {
      return NextResponse.json({ files: [] });
    }
  }

  if (key) {
    // 读取单张图片
    const dir = getJimengImagesDir();
    const candidates = [
      path.join(dir, `${key}.png`),
      path.join(dir, `${key}.jpg`),
      path.join(dir, `${key}.jpeg`),
      path.join(dir, `${key}.webp`),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
          : "image/jpeg";
        return new NextResponse(data, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.json({ error: "Missing key or list parameter" }, { status: 400 });
}

// ═══════════════════════════════════════════════════════════
// POST — 生成图片 / 查询状态 / 保存图片
// ═══════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "generate":
        return handleGenerate(body);
      case "status":
        return handleStatus(body);
      case "save":
        return handleSave(body);
      case "save-history":
        return handleSaveHistory(body);
      case "load-history":
        return handleLoadHistory();
      case "save-page-state":
        return handleSavePageState(body);
      case "load-page-state":
        return handleLoadPageState();
      case "delete-task":
        return handleDeleteTask(body);
      case "delete-file":
        return handleDeleteFile(body);
      case "diagnose":
        return handleDiagnose(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[jimeng-image] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 生成图片 ──

async function handleGenerate(body: Record<string, unknown>) {
  const {
    prompt,
    negativePrompt,
    model,
    ratio,
    resolution,
    count,
    sessionId,
    webId,
    userId,
    referenceImages,
    rawCookies,
  } = body as {
    prompt: string;
    negativePrompt?: string;
    model: JimengImageModelId;
    ratio: JimengImageRatio;
    resolution: JimengImageResolution;
    count: number;
    sessionId: string;
    webId: string;
    userId: string;
    referenceImages?: string[];
    rawCookies?: string;
  };

  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  if (!sessionId || !webId || !userId) {
    return NextResponse.json({ error: "请先在设置页配置即梦登录凭证（sessionId, webId, userId）" }, { status: 400 });
  }

  // 解析参考图 → Buffer（支持 data URL + HTTP URL）
  const referenceBuffers: { buffer: Buffer; originalname: string; size: number }[] = [];
  if (referenceImages && referenceImages.length > 0) {
    console.log(`[jimeng-image] 收到 ${referenceImages.length} 张参考图`);
    for (let i = 0; i < Math.min(referenceImages.length, 7); i++) {
      const imgSrc = referenceImages[i];
      if (!imgSrc || imgSrc.length < 10) {
        console.log(`[jimeng-image] 跳过参考图 ${i + 1}: 空或过短`);
        continue;
      }
      try {
        let buffer: Buffer;
        if (imgSrc.startsWith("data:")) {
          // data URL → Buffer
          const match = imgSrc.match(/^data:image\/[\w+.-]+;base64,(.+)$/);
          if (!match) {
            console.log(`[jimeng-image] 跳过参考图 ${i + 1}: data URL 格式不匹配`);
            continue;
          }
          buffer = Buffer.from(match[1], "base64");
        } else if (imgSrc.startsWith("http://") || imgSrc.startsWith("https://")) {
          // HTTP URL → 下载转 Buffer
          console.log(`[jimeng-image] 下载参考图 ${i + 1}: ${imgSrc.slice(0, 100)}...`);
          const resp = await fetch(imgSrc, { signal: AbortSignal.timeout(30000) });
          if (!resp.ok) {
            console.log(`[jimeng-image] 下载参考图 ${i + 1} 失败: HTTP ${resp.status}`);
            continue;
          }
          buffer = Buffer.from(await resp.arrayBuffer());
        } else {
          console.log(`[jimeng-image] 跳过参考图 ${i + 1}: 不支持的格式 (${imgSrc.slice(0, 40)}...)`);
          continue;
        }
        referenceBuffers.push({ buffer, originalname: `ref-${i + 1}.png`, size: buffer.length });
        console.log(`[jimeng-image] 参考图 ${i + 1} 就绪: ${(buffer.length / 1024).toFixed(0)}KB`);
      } catch (err) {
        console.log(`[jimeng-image] 处理参考图 ${i + 1} 异常:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[jimeng-image] 最终有效参考图: ${referenceBuffers.length}/${referenceImages.length}`);
  }

  // 创建任务
  const taskId = createTaskId();
  const batchCount = Math.ceil((count || 4) / 4);
  const task: JimengImageTask = {
    id: taskId,
    status: "uploading",
    progress: "初始化...",
    startTime: Date.now(),
    results: [],
    error: null,
    batchCount,
    completedBatches: 0,
  };
  setTask(taskId, task);

  // 异步执行生成（不阻塞响应）
  generateJimengImage(taskId, {
    prompt: prompt.slice(0, 1200),
    negativePrompt,
    ratio: ratio || "16:9",
    resolution: resolution || "2K",
    count: Math.min(count || 4, 8),
    model: model || "seedream-5.0",
    sessionId,
    webId,
    userId,
    rawCookies: rawCookies || undefined,
    referenceBuffers: referenceBuffers.length > 0 ? referenceBuffers : undefined,
  }).then((results) => {
    const t = getTask(taskId);
    if (t) {
      t.status = "done";
      t.results = results;
      t.progress = `完成 ${results.length} 张`;
    }
  }).catch((err: unknown) => {
    const error = err as Error & { failCode?: number };
    const t = getTask(taskId);
    if (t) {
      t.status = "error";
      t.error = error.message;
      t.failCode = error.failCode;
      t.progress = "生成失败";
    }
  });

  return NextResponse.json({
    taskId,
    batchCount,
  });
}

// ── 查询任务状态 ──

function handleStatus(body: Record<string, unknown>) {
  const { taskId } = body;
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const task = getTask(taskId as string);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const elapsed = Math.floor((Date.now() - task.startTime) / 1000);

  return NextResponse.json({
    status: task.status,
    progress: task.progress,
    elapsed,
    results: task.results,
    error: task.error,
    failCode: task.failCode,
    batchCount: task.batchCount,
    completedBatches: task.completedBatches,
  });
}

// ── 保存图片到磁盘 ──

async function handleSave(body: Record<string, unknown>) {
  const { imageUrl, key } = body as { imageUrl: string; key: string };
  if (!imageUrl || !key) {
    return NextResponse.json({ error: "imageUrl and key are required" }, { status: 400 });
  }

  const dir = getJimengImagesDir();
  const filePath = path.join(dir, `${key}.png`);

  try {
    if (imageUrl.startsWith("data:")) {
      // data URL → 磁盘
      const match = imageUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!match) throw new Error("Invalid data URL");
      const buffer = Buffer.from(match[1], "base64");
      fs.writeFileSync(filePath, buffer);
    } else if (imageUrl.startsWith("http")) {
      // HTTP URL → 下载 → 磁盘
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
    } else {
      return NextResponse.json({ error: "Unsupported image URL format" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      diskUrl: `/api/jimeng-image?key=${key}`,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 删除任务 ──

function handleDeleteTask(body: Record<string, unknown>) {
  const { taskId } = body;
  if (taskId) deleteTask(taskId as string);
  return NextResponse.json({ success: true });
}

// ── 删除图片文件（支持批量） ──

function handleDeleteFile(body: Record<string, unknown>) {
  const { keys } = body as { keys: string | string[] };
  const keyList = Array.isArray(keys) ? keys : keys ? [keys] : [];
  if (keyList.length === 0) {
    return NextResponse.json({ error: "keys is required" }, { status: 400 });
  }
  const dir = getJimengImagesDir();
  let deleted = 0;
  for (const key of keyList) {
    const exts = [".png", ".jpg", ".jpeg", ".webp"];
    for (const ext of exts) {
      const fp = path.join(dir, `${key}${ext}`);
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); deleted++; } catch { /* ignore */ }
        break;
      }
    }
  }
  return NextResponse.json({ success: true, deleted });
}

// ── 保存任务历史到磁盘 ──

function handleSaveHistory(body: Record<string, unknown>) {
  const { tasks } = body as { tasks: unknown[] };
  if (!Array.isArray(tasks)) {
    return NextResponse.json({ error: "tasks array is required" }, { status: 400 });
  }
  try {
    const dir = getOutputDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "jimeng-task-history.json");
    fs.writeFileSync(filePath, JSON.stringify(tasks.slice(-30), null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 从磁盘加载任务历史 ──

function handleLoadHistory() {
  try {
    const filePath = path.join(getOutputDir(), "jimeng-task-history.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ tasks: [] });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const tasks = JSON.parse(raw);
    return NextResponse.json({ tasks: Array.isArray(tasks) ? tasks : [] });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 保存页面状态到磁盘 ──

function handleSavePageState(body: Record<string, unknown>) {
  const { state } = body as { state: unknown };
  if (!state) return NextResponse.json({ error: "state is required" }, { status: 400 });
  try {
    const dir = getOutputDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "jimeng-page-state.json");
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 从磁盘加载页面状态 ──

function handleLoadPageState() {
  try {
    const filePath = path.join(getOutputDir(), "jimeng-page-state.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ state: null });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(raw);
    return NextResponse.json({ state });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── 浏览器代理诊断 ──

async function handleDiagnose(body: Record<string, unknown>) {
  const { sessionId, webId, userId } = body as {
    sessionId: string;
    webId: string;
    userId: string;
  };
  if (!sessionId || !webId || !userId) {
    return NextResponse.json({ error: "请先配置即梦登录凭证" }, { status: 400 });
  }
  try {
    const result = await diagnoseBrowserProxy(sessionId, webId, userId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message, stack: error.stack?.substring(0, 500) }, { status: 500 });
  }
}
