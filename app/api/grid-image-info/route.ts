import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";

import { resolveGridImageInfoFile } from "@/app/lib/flowStore";
import { requireLicense } from "@/app/lib/license/requireLicense";
import { ensureDir, getBaseOutputDir, getGridImagesDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

function formatFileSize(size: number) {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function resolveCategoryDir(category: string) {
  const safe = category.replace(/[^a-zA-Z0-9_-]/g, "") || "grid-images";
  if (safe === "grid-images") {
    const dir = getGridImagesDir();
    ensureDir(dir);
    return dir;
  }
  const dir = path.join(getBaseOutputDir(), safe);
  ensureDir(dir);
  return dir;
}

async function buildImageInfo(filePath: string) {
  const stat = fs.statSync(filePath);
  let resolution = "未知";

  try {
    const meta = await sharp(filePath).metadata();
    if (meta.width && meta.height) {
      resolution = `${meta.width} × ${meta.height}`;
    }
  } catch {
    // ignore
  }

  return {
    filename: path.basename(filePath),
    size: stat.size,
    sizeFormatted: formatFileSize(stat.size),
    resolution,
    mtime: stat.mtime.toISOString(),
    path: filePath,
  };
}

function revealFile(filePath: string) {
  if (process.platform === "win32") {
    spawn("explorer.exe", ["/select,", filePath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const folder = path.dirname(filePath);
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [folder], { detached: true, stdio: "ignore" }).unref();
}

function openFolder(dirPath: string) {
  if (process.platform === "win32") {
    spawn("explorer.exe", [dirPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [dirPath], { detached: true, stdio: "ignore" }).unref();
}

function resolveFileFromRequest(keyOrFilename: string, category: string) {
  const resolved = resolveGridImageInfoFile(category, keyOrFilename);
  if (resolved) return resolved;

  const dir = resolveCategoryDir(category);
  const direct = path.join(dir, path.basename(keyOrFilename));
  return fs.existsSync(direct) ? direct : null;
}

export async function GET(request: NextRequest) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  const searchParams = request.nextUrl.searchParams;
  const key = String(searchParams.get("key") || searchParams.get("filename") || "").trim();
  const category = String(searchParams.get("category") || "grid-images").trim() || "grid-images";

  if (!key) {
    return NextResponse.json({ error: "缺少 key" }, { status: 400 });
  }

  const filePath = resolveFileFromRequest(key, category);
  if (!filePath) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  return NextResponse.json(await buildImageInfo(filePath));
}

export async function POST(request: Request) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      key?: string;
      filename?: string;
      category?: string;
    };
    const action = String(body.action || "reveal").trim() || "reveal";
    const category = String(body.category || "grid-images").trim() || "grid-images";

    if (action === "open-folder") {
      const dir = resolveCategoryDir(category);
      openFolder(dir);
      return NextResponse.json({ success: true, path: dir });
    }

    const key = String(body.key || body.filename || "").trim();
    if (!key) {
      return NextResponse.json({ error: "缺少 key" }, { status: 400 });
    }

    const filePath = resolveFileFromRequest(key, category);
    if (!filePath) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    if (action === "reveal") {
      revealFile(filePath);
      return NextResponse.json({ success: true, path: filePath });
    }

    return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 },
    );
  }
}
