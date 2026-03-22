import fs from "fs";
import path from "path";
import sharp from "sharp";
import { NextResponse } from "next/server";

import {
  buildGridExpansionPrompt,
  buildCustomGridPushPayload,
  calculateSubGridCells,
  clampGridCount,
  parseGridPromptLines,
  resolveGridDimension,
  splitTextIntoGridPrompts,
} from "@/app/lib/gridExpansion";
import { ensureDir, getBaseOutputDir } from "@/app/lib/paths";
import { requireLicense } from "@/app/lib/license/requireLicense";
import { resolveProjectRoot } from "@/app/lib/runtimePaths";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OUTPUT_DIR = path.join(getBaseOutputDir(), "grid-expand");
const PROJECT_ROOT = resolveProjectRoot();

function readProjectPrompt(name: string): string {
  try {
    const filePath = path.join(PROJECT_ROOT, name);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore
  }
  return "";
}

function sanitizeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9_\-.]/g, "-");
}

function decodeDataUrl(dataUrl: string): Buffer {
  const matched = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matched) {
    throw new Error("不支持的图片格式，需为 data URL");
  }
  return Buffer.from(matched[2], "base64");
}

function getImageMime(ext: string) {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function listGridExpandImages() {
  ensureDir(OUTPUT_DIR);
  return fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {
    // fall through
  }
  return fallback;
}

export async function GET(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  ensureDir(OUTPUT_DIR);
  const { searchParams } = new URL(request.url);

  if (searchParams.get("list") === "1") {
    const items = listGridExpandImages().map((name) => ({
      key: name,
      url: `/api/grid-expand?key=${encodeURIComponent(name)}`,
    }));
    return NextResponse.json({ items, dir: OUTPUT_DIR });
  }

  const rawKey = searchParams.get("key");
  if (!rawKey) {
    return NextResponse.json({ error: "缺少 key 或 list 参数" }, { status: 400 });
  }

  const safeKey = sanitizeStem(rawKey);
  const filePath = path.join(OUTPUT_DIR, safeKey);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: {
      "Content-Type": getImageMime(ext),
      "Cache-Control": "no-cache",
      "Content-Length": String(data.length),
    },
  });
}

export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  ensureDir(OUTPUT_DIR);

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "").trim();

    if (action === "build-prompt") {
      const title = String(body.title || "").trim();
      const sourceText = String(body.sourceText || body.text || "").trim();
      const gridCount = clampGridCount(Number(body.gridCount || 9));
      const customPrompt = String(body.customPrompt || "").trim();
      const defaultPrompt =
        customPrompt ||
        (gridCount >= 25
          ? readProjectPrompt("25宫格分镜Gem.txt") || readProjectPrompt("Gemini生图专用Gem.txt")
          : "");

      if (!sourceText) {
        return NextResponse.json({ error: "缺少 sourceText" }, { status: 400 });
      }

      const prompt = buildGridExpansionPrompt(sourceText, gridCount, title, defaultPrompt);
      const prompts = splitTextIntoGridPrompts(sourceText, gridCount);
      return NextResponse.json({
        success: true,
        prompt,
        prompts,
        payload: buildCustomGridPushPayload(prompts, gridCount),
      });
    }

    if (action === "split") {
      const image = String(body.image || body.imageDataUrl || "").trim();
      const gridCount = clampGridCount(Number(body.gridCount || 9));
      const stem = sanitizeStem(String(body.stem || `grid-expand-${Date.now()}`));

      if (!image) {
        return NextResponse.json({ error: "缺少 image" }, { status: 400 });
      }

      let inputBuffer = decodeDataUrl(image);
      let metadata = await sharp(inputBuffer).metadata();
      if (!metadata.width || !metadata.height) {
        return NextResponse.json({ error: "无法识别图片尺寸" }, { status: 400 });
      }

      const { cols, rows } = resolveGridDimension(gridCount);
      if (metadata.width < cols || metadata.height < rows) {
        inputBuffer = await sharp(inputBuffer)
          .resize({
            width: Math.max(metadata.width, cols * 128),
            height: Math.max(metadata.height, rows * 128),
            fit: "fill",
          })
          .png()
          .toBuffer();
        metadata = await sharp(inputBuffer).metadata();
      }

      const cells = calculateSubGridCells(metadata.width, metadata.height, gridCount);
      const saved: Array<{ index: number; key: string; url: string; width: number; height: number }> = [];

      for (const cell of cells) {
        const key = `${stem}-${String(cell.index + 1).padStart(2, "0")}.png`;
        const filePath = path.join(OUTPUT_DIR, key);
        await sharp(inputBuffer)
          .extract({
            left: cell.left,
            top: cell.top,
            width: cell.width,
            height: cell.height,
          })
          .png()
          .toFile(filePath);

        saved.push({
          index: cell.index,
          key,
          url: `/api/grid-expand?key=${encodeURIComponent(key)}`,
          width: cell.width,
          height: cell.height,
        });
      }

      return NextResponse.json({
        success: true,
        gridCount,
        items: saved,
        dir: OUTPUT_DIR,
      });
    }

    if (action === "save-jimeng-cells") {
      const storageKey = sanitizeStem(String(body.storageKey || "default"));
      const cells = Array.isArray(body.cells) ? body.cells : [];
      const filePath = path.join(OUTPUT_DIR, `${storageKey}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            savedAt: new Date().toISOString(),
            cells,
          },
          null,
          2,
        ),
        "utf-8",
      );
      return NextResponse.json({ success: true, filePath });
    }

    if (action === "load-jimeng-cells") {
      const storageKey = sanitizeStem(String(body.storageKey || "default"));
      const filePath = path.join(OUTPUT_DIR, `${storageKey}.json`);
      const data = loadJsonFile<{ savedAt?: string; cells?: unknown[] }>(filePath, { cells: [] });
      return NextResponse.json({
        success: true,
        filePath,
        savedAt: data.savedAt || null,
        cells: Array.isArray(data.cells) ? data.cells : [],
      });
    }

    if (action === "parse-lines") {
      const content = String(body.content || "").trim();
      const gridCount = clampGridCount(Number(body.gridCount || 9));
      if (!content) {
        return NextResponse.json({ error: "缺少 content" }, { status: 400 });
      }
      const prompts = parseGridPromptLines(content, gridCount);
      return NextResponse.json({
        success: true,
        prompts,
        payload: buildCustomGridPushPayload(prompts, gridCount),
      });
    }

    return NextResponse.json({ error: "不支持的 action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
