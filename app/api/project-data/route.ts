/**
 * 项目数据文件持久化 API
 *
 * 在 outputs/projects/{project-id}/ 目录下保存 metadata.json
 * 包含完整的一致性数据（角色/场景/道具名称、描述、提示词、参考图ID）+ 项目元数据
 * 确保即使 IndexedDB 被清除，项目数据也能从磁盘恢复
 *
 * GET /api/project-data                 — 列出所有已保存的项目
 * GET /api/project-data?id=proj_xxx     — 读取单个项目的 metadata.json
 * POST /api/project-data                — 保存项目数据到磁盘
 * DELETE /api/project-data?id=proj_xxx  — 删除项目数据
 */

import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { getBaseOutputDir } from "@/app/lib/paths";
import { requireLicense } from "@/app/lib/license/requireLicense";

export const dynamic = "force-dynamic";

function getProjectsDir() {
  return join(getBaseOutputDir(), "projects");
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * GET — 列出所有项目 或 读取单个项目
 */
export async function GET(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const projDir = getProjectsDir();

    if (id) {
      // 读取单个项目
      const sanitized = id.replace(/[^a-zA-Z0-9_\-\.]/g, "");
      const metaPath = join(projDir, sanitized, "metadata.json");
      if (!existsSync(metaPath)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const raw = readFileSync(metaPath, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json({ project: data });
    }

    // 列出所有已保存的项目
    ensureDir(projDir);
    const dirs = readdirSync(projDir).filter(d => {
      const metaPath = join(projDir, d, "metadata.json");
      return existsSync(metaPath);
    });

    const summaries = dirs.map(d => {
      try {
        const metaPath = join(projDir, d, "metadata.json");
        const raw = readFileSync(metaPath, "utf-8");
        const data = JSON.parse(raw);
        return {
          id: data.id || d,
          name: data.name || "未命名",
          updatedAt: data.updatedAt || "",
          characterCount: data.consistency?.characters?.length || 0,
          sceneCount: data.consistency?.scenes?.length || 0,
          propCount: data.consistency?.props?.length || 0,
        };
      } catch {
        return { id: d, name: d, updatedAt: "", characterCount: 0, sceneCount: 0, propCount: 0 };
      }
    });

    return NextResponse.json({ projects: summaries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST — 保存项目数据到磁盘
 * Body: { project: ArchivedProject }
 */
export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const { project } = await request.json();
    if (!project || !project.id) {
      return NextResponse.json({ error: "Missing project or project.id" }, { status: 400 });
    }

    const sanitizedId = String(project.id).replace(/[^a-zA-Z0-9_\-\.]/g, "");
    if (!sanitizedId) {
      return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
    }

    const projDir = join(getProjectsDir(), sanitizedId);
    ensureDir(projDir);

    // 保存完整项目元数据（不含图片 data URL，只保留引用路径）
    const metadata = {
      id: project.id,
      name: project.name,
      episode: project.episode,
      episodeCount: project.episodeCount,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt || new Date().toISOString(),
      version: project.version,
      parentId: project.parentId,
      tags: project.tags,
      description: project.description,
      // ★ 完整一致性数据（名称、描述、提示词、参考图ID）
      consistency: project.consistency,
      // ★ 动态 KV 条目
      dynamicKV: project.dynamicKV,
      // ★ 输出文件清单（不存文件内容，只存文件名）
      outputFileNames: project.outputFiles?.map((f: { name: string }) => f.name) || [],
      // 统计
      imageCount: project.imageCount,
      imageKeys: project.imageKeys,
      savedAt: new Date().toISOString(),
    };

    writeFileSync(join(projDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

    // 如果有输出文件内容，一并保存
    if (project.outputFiles?.length > 0) {
      const outputDir = join(projDir, "output-files");
      ensureDir(outputDir);
      for (const f of project.outputFiles) {
        if (f.name && f.content) {
          const safeName = f.name.replace(/[<>:"/\\|?*]/g, "_");
          writeFileSync(join(outputDir, safeName), f.content, "utf-8");
        }
      }
    }

    const stat = statSync(join(projDir, "metadata.json"));
    const sizeKB = Math.round(stat.size / 1024);
    console.log(`[project-data] 保存项目 ${project.name} (${sanitizedId}) → ${sizeKB}KB`);

    return NextResponse.json({ success: true, id: sanitizedId, sizeKB });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE — 删除项目数据
 */
export async function DELETE(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const sanitized = id.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const projDir = join(getProjectsDir(), sanitized);

    if (existsSync(projDir)) {
      rmSync(projDir, { recursive: true, force: true });
      console.log(`[project-data] 删除项目目录: ${sanitized}`);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
