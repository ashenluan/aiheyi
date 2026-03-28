import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";

import sharp from "sharp";

import { ensureDir, getBaseOutputDir, getGridImagesDir } from "@/app/lib/paths";

export const FLOW_URL = "https://labs.google/fx/zh/tools/flow";
const MAX_LISTED_IMAGES = 2000;
const FLOW_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

export interface FlowExtensionTask {
  id: string;
  prompt: string;
  cellLabel?: string;
  refImages?: string[];
  aspectRatio?: string;
  selected?: boolean;
  createdAt: number;
  copiedAt?: number;
  status?: "pending" | "copied";
}

export interface FlowUpsampleTask {
  id: string;
  imageKey: string;
  filename?: string;
  targetSize: "2K" | "4K";
  status: "pending" | "processing" | "done" | "error";
  createdAt: number;
  updatedAt: number;
  outputKey?: string;
  error?: string;
}

export interface FlowImageListItem {
  key: string;
  filename: string;
  size: number;
  timestamp: number;
  path: string;
  resolution?: string;
}

interface FlowState {
  cookie?: string;
  lastCookieCheckAt?: string;
  lastCookieCheckOk?: boolean;
  lastCookieCheckMessage?: string;
}

function getFlowDataDir(): string {
  const dir = path.join(getBaseOutputDir(), "flow-data");
  ensureDir(dir);
  return dir;
}

export function getFlowImagesDir(): string {
  const dir = path.join(getBaseOutputDir(), "flow-images");
  ensureDir(dir);
  return dir;
}

function getExtensionTasksFile(): string {
  return path.join(getFlowDataDir(), "flow-extension-tasks.json");
}

function getUpsampleTasksFile(): string {
  return path.join(getFlowDataDir(), "flow-upsample-tasks.json");
}

function getHiddenImagesFile(): string {
  return path.join(getFlowDataDir(), "flow-hidden-images.json");
}

function getStateFile(): string {
  return path.join(getFlowDataDir(), "flow-state.json");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sanitizeFilenameStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeImageExt(ext: string) {
  const normalized = ext.toLowerCase();
  return normalized === ".jpeg" ? ".jpg" : normalized;
}

function resolveImageFile(dir: string, keyOrFilename: string): string | null {
  const safe = sanitizeFilenameStem(path.basename(keyOrFilename));
  if (!safe) return null;

  const direct = path.join(dir, safe);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  const ext = path.extname(safe);
  if (!ext) {
    for (const candidateExt of FLOW_IMAGE_EXTENSIONS) {
      const candidate = path.join(dir, `${safe}${candidateExt}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  return null;
}

async function inferResolutionLabel(filePath: string): Promise<string | undefined> {
  try {
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) return undefined;
    return `${meta.width} × ${meta.height}`;
  } catch {
    return undefined;
  }
}

export function loadFlowExtensionTasks(): FlowExtensionTask[] {
  return readJsonFile<FlowExtensionTask[]>(getExtensionTasksFile(), []);
}

export function saveFlowExtensionTasks(tasks: FlowExtensionTask[]) {
  writeJsonFile(getExtensionTasksFile(), tasks);
}

export function loadFlowUpsampleTasks(): FlowUpsampleTask[] {
  return readJsonFile<FlowUpsampleTask[]>(getUpsampleTasksFile(), []);
}

export function saveFlowUpsampleTasks(tasks: FlowUpsampleTask[]) {
  writeJsonFile(getUpsampleTasksFile(), tasks);
}

function loadHiddenFlowImages(): string[] {
  return readJsonFile<string[]>(getHiddenImagesFile(), []);
}

function saveHiddenFlowImages(items: string[]) {
  writeJsonFile(getHiddenImagesFile(), [...new Set(items)]);
}

export function hideFlowImages(filenames?: string[]) {
  if (!filenames?.length) {
    const all = fs.readdirSync(getFlowImagesDir()).filter((file) =>
      FLOW_IMAGE_EXTENSIONS.includes(normalizeImageExt(path.extname(file))),
    );
    saveHiddenFlowImages(all);
    return;
  }

  const current = loadHiddenFlowImages();
  saveHiddenFlowImages([...current, ...filenames.map((item) => path.basename(item))]);
}

export async function listFlowImages(): Promise<FlowImageListItem[]> {
  const dir = getFlowImagesDir();
  const hidden = new Set(loadHiddenFlowImages());
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => FLOW_IMAGE_EXTENSIONS.includes(normalizeImageExt(path.extname(file))))
    : [];

  const items = await Promise.all(
    files
      .filter((filename) => !hidden.has(filename))
      .map(async (filename) => {
        const filePath = path.join(dir, filename);
        const stat = fs.statSync(filePath);
        return {
          key: filename.replace(/\.[^.]+$/, ""),
          filename,
          size: stat.size,
          timestamp: stat.mtimeMs,
          path: filePath,
          resolution: await inferResolutionLabel(filePath),
        } satisfies FlowImageListItem;
      }),
  );

  return items.sort((left, right) => right.timestamp - left.timestamp).slice(0, MAX_LISTED_IMAGES);
}

export function loadFlowState(): FlowState {
  return readJsonFile<FlowState>(getStateFile(), {});
}

export function saveFlowState(nextState: FlowState) {
  writeJsonFile(getStateFile(), nextState);
}

export function getStoredFlowCookie(): string {
  const envCookie = String(process.env.FEICAI_FLOW_COOKIE || "").trim();
  if (envCookie) return envCookie;
  return String(loadFlowState().cookie || "").trim();
}

export function updateStoredFlowCookie(cookie: string) {
  const state = loadFlowState();
  saveFlowState({ ...state, cookie: cookie.trim() });
}

export function rememberFlowCookieCheck(ok: boolean, message: string) {
  const state = loadFlowState();
  saveFlowState({
    ...state,
    lastCookieCheckAt: new Date().toISOString(),
    lastCookieCheckOk: ok,
    lastCookieCheckMessage: message,
  });
}

export async function validateFlowCookie(cookie: string) {
  const trimmed = cookie.trim();
  if (!trimmed) {
    return { ok: false, message: "缺少 Flow Cookie" };
  }

  try {
    const response = await fetch(FLOW_URL, {
      headers: {
        Cookie: trimmed,
        "User-Agent": `Mozilla/5.0 (${os.platform()}) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return { ok: false, message: `Flow Cookie 校验失败 (${response.status})` };
    }

    const html = await response.text();
    const looksLoggedIn =
      /flow|imagen|create|generate|google/i.test(html) &&
      !/登录|sign in|signin/i.test(html);
    return {
      ok: looksLoggedIn,
      message: looksLoggedIn ? "Flow Cookie 校验通过" : "Flow Cookie 可能已失效，请重新获取",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Flow Cookie 校验失败",
    };
  }
}

function resolveChromeBinary(): string | null {
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function openFlowInBrowser() {
  const chromeBinary = resolveChromeBinary();

  if (process.platform === "win32") {
    if (chromeBinary) {
      spawn(chromeBinary, ["--incognito", FLOW_URL], { detached: true, stdio: "ignore" }).unref();
      return { opened: true, incognito: true };
    }
    spawn("cmd.exe", ["/c", "start", "", FLOW_URL], { detached: true, stdio: "ignore" }).unref();
    return { opened: true, incognito: false };
  }

  spawn("open", [FLOW_URL], { detached: true, stdio: "ignore" }).unref();
  return { opened: true, incognito: false };
}

export async function saveFlowImageFromSource(input: {
  filename?: string;
  imageUrl?: string;
  imageData?: string;
  prefix?: string;
}) {
  const dir = getFlowImagesDir();
  ensureDir(dir);

  let buffer: Buffer;
  let ext = ".png";

  if (input.imageData?.startsWith("data:")) {
    const match = input.imageData.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) throw new Error("无效的图片数据");
    ext = match[1].includes("png") ? ".png" : match[1].includes("webp") ? ".webp" : ".jpg";
    buffer = Buffer.from(match[2], "base64");
  } else if (input.imageUrl) {
    const response = await fetch(input.imageUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`图片下载失败 (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    ext = contentType.includes("webp") ? ".webp" : contentType.includes("png") ? ".png" : ".jpg";
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error("缺少 imageData 或 imageUrl");
  }

  const digest = createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const stem =
    sanitizeFilenameStem(
      input.filename
        ? path.basename(input.filename, path.extname(input.filename))
        : `${input.prefix || "flow"}-${Date.now()}-${digest}`,
    ) || `flow-${Date.now()}-${digest}`;

  const filename = `${stem}${normalizeImageExt(ext)}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);

  return {
    key: stem,
    filename,
    path: filePath,
    size: buffer.length,
    url: `/api/local-file/flow-images/${stem}`,
    resolution: await inferResolutionLabel(filePath),
  };
}

export function addFlowExtensionTasks(payload: Partial<FlowExtensionTask> | Array<Partial<FlowExtensionTask>>) {
  const current = loadFlowExtensionTasks();
  const list = Array.isArray(payload) ? payload : [payload];
  const created = list
    .filter((item) => typeof item.prompt === "string" && item.prompt.trim())
    .map((item) => ({
      id: item.id || `flow-ext-${randomUUID()}`,
      prompt: String(item.prompt || "").trim(),
      cellLabel: typeof item.cellLabel === "string" ? item.cellLabel : undefined,
      refImages: Array.isArray(item.refImages) ? item.refImages.filter(Boolean) : [],
      aspectRatio: typeof item.aspectRatio === "string" ? item.aspectRatio : "16:9",
      selected: item.selected ?? true,
      createdAt: item.createdAt ?? Date.now(),
      copiedAt: item.copiedAt,
      status: item.copiedAt ? "copied" : "pending",
    } satisfies FlowExtensionTask));

  if (!created.length) return [];
  const next = [...created, ...current].slice(0, 500);
  saveFlowExtensionTasks(next);
  return created;
}

export function markFlowExtensionTaskCopied(taskId: string) {
  const next = loadFlowExtensionTasks().map((task) =>
    task.id === taskId
      ? {
          ...task,
          copiedAt: Date.now(),
          status: "copied" as const,
        }
      : task,
  );
  saveFlowExtensionTasks(next);
}

export function deleteFlowExtensionTask(taskId: string) {
  saveFlowExtensionTasks(loadFlowExtensionTasks().filter((task) => task.id !== taskId));
}

export function clearFlowExtensionTasks() {
  saveFlowExtensionTasks([]);
}

export function queueFlowUpsampleTask(input: {
  imageKey: string;
  filename?: string;
  targetSize: "2K" | "4K";
}) {
  const current = loadFlowUpsampleTasks();
  const task: FlowUpsampleTask = {
    id: `flow-up-${randomUUID()}`,
    imageKey: input.imageKey,
    filename: input.filename,
    targetSize: input.targetSize,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveFlowUpsampleTasks([task, ...current].slice(0, 500));
  return task;
}

export function updateFlowUpsampleTask(
  taskId: string,
  patch: Partial<FlowUpsampleTask>,
) {
  const next = loadFlowUpsampleTasks().map((task) =>
    task.id === taskId
      ? {
          ...task,
          ...patch,
          updatedAt: Date.now(),
        }
      : task,
  );
  saveFlowUpsampleTasks(next);
  return next.find((task) => task.id === taskId) || null;
}

export function buildFlowStatus() {
  const imagesDir = getFlowImagesDir();
  const imageCount = fs.existsSync(imagesDir)
    ? fs.readdirSync(imagesDir).filter((file) => FLOW_IMAGE_EXTENSIONS.includes(normalizeImageExt(path.extname(file)))).length
    : 0;
  const extensionTasks = loadFlowExtensionTasks().filter((task) => task.status !== "copied").length;
  const upsamplePending = loadFlowUpsampleTasks().filter((task) => task.status === "pending" || task.status === "processing").length;
  const state = loadFlowState();
  return {
    status: "ok",
    mode: "http",
    engine: "builtin",
    hasCookie: Boolean(getStoredFlowCookie()),
    imageCount,
    extensionTasks,
    upsamplePending,
    lastCookieCheckAt: state.lastCookieCheckAt,
    lastCookieCheckOk: state.lastCookieCheckOk,
    lastCookieCheckMessage: state.lastCookieCheckMessage,
  };
}

export function resolveGridImageInfoFile(category: string, key: string) {
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "");
  let dir: string;
  if (safeCategory === "grid-images") {
    dir = getGridImagesDir();
  } else {
    dir = path.join(getBaseOutputDir(), safeCategory);
    ensureDir(dir);
  }
  return resolveImageFile(dir, safeKey);
}


