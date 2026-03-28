import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getBaseOutputDir } from "@/app/lib/paths";
import { resolveProjectFile, resolveProjectRoot } from "@/app/lib/runtimePaths";

export const dynamic = "force-dynamic";

function buildTargets() {
  const root = resolveProjectRoot();
  const geminiRoot = fs.existsSync(resolveProjectFile("GeminiTab-dist"))
    ? resolveProjectFile("GeminiTab-dist")
    : resolveProjectFile("GeminiTab");
  const outputsRoot = getBaseOutputDir();

  return {
    projectRoot: root,
    geminiRoot,
    geminiBrowserData: path.join(geminiRoot, "browser-data"),
    geminiDebugScreenshots: path.join(geminiRoot, "debug-screenshots"),
    geminiTempUploads: path.join(geminiRoot, "temp-uploads"),
    outputsRoot,
    flowImages: path.join(outputsRoot, "flow-images"),
  };
}

function ensureTargetPath(target: string): string {
  const targets = buildTargets();
  const named = targets[target as keyof typeof targets];
  if (named) return named;

  const customPath = path.resolve(String(target || ""));
  const root = resolveProjectRoot();
  const outputRoot = getBaseOutputDir();
  const allowedPrefixes = [root, outputRoot];
  if (!allowedPrefixes.some((prefix) => customPath.startsWith(prefix))) {
    throw new Error("仅允许打开项目目录或输出目录下的路径");
  }
  return customPath;
}

function openFolder(folderPath: string) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  if (process.platform === "win32") {
    spawn("explorer.exe", [folderPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [folderPath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [folderPath], { detached: true, stdio: "ignore" }).unref();
}

export async function GET() {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const targets = buildTargets();
    return NextResponse.json({
      targets: Object.entries(targets).map(([id, folderPath]) => ({
        id,
        path: folderPath,
        exists: fs.existsSync(folderPath),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const type = url.searchParams.get("type");
    const target = typeof body.target === "string" ? body.target : "";
    const rawPath = typeof body.path === "string" ? body.path : "";
    const compatTarget =
      type === "temp-uploads"
        ? "geminiTempUploads"
        : type === "outputs" || type === "grid-images"
          ? "outputsRoot"
          : type === "flow-images"
            ? "flowImages"
            : "";
    const folderPath = ensureTargetPath(rawPath || target || compatTarget || "outputsRoot");
    openFolder(folderPath);
    return NextResponse.json({
      success: true,
      path: folderPath,
      openedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
