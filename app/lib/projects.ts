/**
 * Project archive management.
 *
 * When the user clicks "新项目", the current workspace (studio state, consistency,
 * pipeline state, system prompts, grid images) is archived as a named project.
 * Archived projects appear on the overview page and can be restored to the workspace.
 *
 * Storage:
 *  - Project list + text metadata → IndexedDB via kvDB ("feicai-projects")
 *  - Archived images → IndexedDB with "archive:{projectId}:{originalKey}" prefixed keys
 */

import type { ConsistencyProfile } from "./consistency";
import { loadConsistencyAsync, saveConsistency, defaultProfile } from "./consistency";
import { loadGridImagesByFilterDB, loadGridImageKeysByFilterDB, saveGridImagesDB, deleteGridImageDB } from "./imageDB";
import { loadGridImageUrlsFromDisk, saveGridImagesToDisk } from "./gridImageStore";
import { kvLoad, kvSet, kvRemove, kvRemoveByPrefix, kvKeysByPrefix } from "./kvDB";

// ── Types ──

export interface ArchivedProject {
  id: string;
  name: string;
  episode: string;
  episodeCount: number;   // number of episodes detected at archive time
  createdAt: string;      // ISO
  updatedAt: string;      // ISO

  // Archived text data snapshots
  studioState: Record<string, unknown> | null;
  consistency: ConsistencyProfile | null;
  pipelineState: string | null;   // raw JSON
  systemPrompts: string | null;   // raw JSON
  videoStates: string | null;     // raw JSON — feicai-video-states

  // List of image keys stored in IndexedDB as "archive:{id}:{key}"
  imageKeys: string[];

  // Archived output files (prompts, breakdowns, etc.)
  outputFiles?: { name: string; content: string }[];

  // ★ 动态 KV 条目（智能分镜/节拍提示词/运镜提示词等按集数存储的前缀型键）
  dynamicKV?: { key: string; value: string }[];

  // Quick stats
  imageCount: number;

  // 版本管理（向后兼容，均为可选）
  version?: number;         // 版本号，覆盖保存时递增
  parentId?: string;        // 父项目 ID（版本树）
  tags?: string[];           // 自定义标签
  description?: string;      // 项目备注
}

const PROJECTS_KEY = "feicai-projects";
const ACTIVE_PROJECT_KEY = "feicai-active-project";

// ── Active Project Tracking ──

/** 同步项目 ID 到磁盘文件（供服务端 grid-images 路径隔离用） */
async function syncProjectIdToDisk(projectId: string | null): Promise<void> {
  try {
    await fetch("/api/active-project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
  } catch (e) {
    console.warn("[projects] 同步项目ID到磁盘失败:", e);
  }
}

export async function getActiveProjectId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return await kvLoad(ACTIVE_PROJECT_KEY);
}

export async function setActiveProjectId(id: string): Promise<void> {
  await kvSet(ACTIVE_PROJECT_KEY, id);
  // ★ 同步：IndexedDB + 磁盘文件双写，确保服务端也能感知项目切换
  await syncProjectIdToDisk(id);
}

export async function clearActiveProjectId(): Promise<void> {
  await kvRemove(ACTIVE_PROJECT_KEY);
  // ★ 注意：磁盘文件由 clearCurrentWorkspace 单独控制时序（先删图片再清文件）
  //   所以这里 NOT 调用 syncProjectIdToDisk(null)
}

// ── CRUD ──

export async function loadProjects(): Promise<ArchivedProject[]> {
  if (typeof window === "undefined") return [];
  try {
    const saved = await kvLoad(PROJECTS_KEY);
    if (saved) {
      const projects: ArchivedProject[] = JSON.parse(saved);
      if (projects.length > 0) return projects;
    }
  } catch { /* ignore */ }
  // ★ IDB 为空/损坏时，尝试从磁盘恢复
  try {
    return await loadProjectsFromDisk();
  } catch {
    return [];
  }
}

function normalizeDiskProject(diskData: Record<string, unknown>): ArchivedProject {
  return {
    id: String(diskData.id || ""),
    name: String(diskData.name || "未命名"),
    episode: String(diskData.episode || "ep01"),
    episodeCount: Number(diskData.episodeCount || 1),
    createdAt: String(diskData.createdAt || ""),
    updatedAt: String(diskData.updatedAt || ""),
    studioState: null,
    consistency: (diskData.consistency as ConsistencyProfile | null) || null,
    pipelineState: null,
    systemPrompts: null,
    videoStates: null,
    imageKeys: Array.isArray(diskData.imageKeys) ? diskData.imageKeys as string[] : [],
    imageCount: Number(diskData.imageCount || 0),
    dynamicKV: Array.isArray(diskData.dynamicKV)
      ? diskData.dynamicKV as { key: string; value: string }[]
      : [],
    version: typeof diskData.version === "number" ? diskData.version : undefined,
    parentId: typeof diskData.parentId === "string" ? diskData.parentId : undefined,
    tags: Array.isArray(diskData.tags) ? diskData.tags as string[] : undefined,
    description: typeof diskData.description === "string" ? diskData.description : undefined,
    outputFiles: Array.isArray(diskData.outputFiles) ? diskData.outputFiles as { name: string; content: string }[] : undefined,
  };
}

export async function loadProjectFromDisk(projectId: string): Promise<ArchivedProject | null> {
  if (typeof window === "undefined") return null;
  try {
    const detailRes = await fetch(`/api/project-data?id=${encodeURIComponent(projectId)}`);
    if (!detailRes.ok) return null;
    const { project: diskData } = await detailRes.json();
    if (!diskData || typeof diskData !== "object") return null;
    return normalizeDiskProject(diskData as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function syncProjectFromDisk(projectId: string): Promise<ArchivedProject | null> {
  const project = await loadProjectFromDisk(projectId);
  if (!project) return null;

  const projects = await loadProjects();
  const idx = projects.findIndex((entry) => entry.id === project.id);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.unshift(project);
  }
  await saveProjects(projects);
  return project;
}

/** ★ 保存项目元数据到磁盘文件 outputs/projects/{id}/metadata.json */
async function saveProjectToDisk(project: ArchivedProject): Promise<void> {
  try {
    await fetch("/api/project-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    });
  } catch (e) {
    console.warn("[projects] 磁盘持久化失败:", e);
  }
}

/** ★ 从磁盘恢复项目列表（IDB 降级方案） */
async function loadProjectsFromDisk(): Promise<ArchivedProject[]> {
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch("/api/project-data");
    if (!res.ok) return [];
    const { projects: summaries } = await res.json();
    if (!Array.isArray(summaries) || summaries.length === 0) return [];

    // 逐个加载完整项目数据
    const fullProjects: ArchivedProject[] = [];
    for (const s of summaries) {
      try {
        const detailRes = await fetch(`/api/project-data?id=${encodeURIComponent(s.id)}`);
        if (!detailRes.ok) continue;
        const { project: diskData } = await detailRes.json();
        if (!diskData) continue;

        const proj = normalizeDiskProject(diskData as Record<string, unknown>);
        fullProjects.push(proj);
      } catch { /* skip */ }
    }

    if (fullProjects.length > 0) {
      console.log(`[projects] ★ 从磁盘恢复了 ${fullProjects.length} 个项目（IDB 为空）`);
      // 回写到 IDB（自动修复）
      await saveProjects(fullProjects);
    }
    return fullProjects;
  } catch {
    return [];
  }
}

export async function saveProjects(projects: ArchivedProject[]) {
  try {
    await kvSet(PROJECTS_KEY, JSON.stringify(projects));
  } catch { /* ignore */ }
}

/** ★ 导出磁盘持久化函数供外部调用 */
export async function persistProjectToDisk(project: ArchivedProject): Promise<void> {
  return saveProjectToDisk(project);
}

// ── Rename ──

export async function renameProject(projectId: string, newName: string): Promise<void> {
  const projects = await loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return;
  projects[idx].name = newName;
  projects[idx].updatedAt = new Date().toISOString();
  await saveProjects(projects);
}

// ── Workspace Snapshot Helper ──

interface WorkspaceSnapshot {
  studioState: Record<string, unknown> | null;
  strippedConsistency: ConsistencyProfile;
  pipelineState: string | null;
  systemPrompts: string | null;
  videoStates: string | null;
  episode: string;
  episodeCount: number;
  outputFiles: { name: string; content: string }[];
  imageKeys: string[];
  archiveImages: Record<string, string>;
  dynamicKV: { key: string; value: string }[];
}

/** 采集当前工作台完整快照（文本数据 + 图片 + 输出文件） */
async function takeWorkspaceSnapshot(projectId: string): Promise<WorkspaceSnapshot> {
  const studioState = safeJsonParse(await kvLoad("feicai-studio-state"));
  const consistency = await loadConsistencyAsync();
  const pipelineState = await kvLoad("feicai-pipeline-state");
  const systemPrompts = await kvLoad("feicai-system-prompts");
  const videoStates = await kvLoad("feicai-video-states");
  const episode = studioState?.episode || "ep01";

  let episodeCount = 1;
  let outputFiles: { name: string; content: string }[] = [];
  try {
    const res = await fetch("/api/outputs", { method: "POST" });
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    const files: { name: string; content: string }[] = await res.json();
    outputFiles = files;
    const epSet = new Set<string>();
    for (const f of files) {
      const m = f.name.match(/-(ep\d+)/);
      if (m) epSet.add(m[1]);
    }
    if (epSet.size > 0) episodeCount = epSet.size;
  } catch { /* fallback to 1 */ }

  const diskUrls = await loadGridImageUrlsFromDisk();
  const imageKeys: string[] = Object.keys(diskUrls);
  const archiveImages: Record<string, string> = {};

  let archiveFailCount = 0;
  for (const key of imageKeys) {
    try {
      const res = await fetch(diskUrls[key]);
      if (!res.ok) {
        console.warn(`[archive] 图片获取失败: ${key} → HTTP ${res.status}`);
        archiveFailCount++;
        continue;
      }
      const blob = await res.blob();
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string | null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
        archiveImages[`archive:${projectId}:${key}`] = dataUrl;
      } else {
        console.warn(`[archive] 图片转换失败(null/非dataUrl): ${key}`);
        archiveFailCount++;
      }
    } catch (e) {
      console.warn(`[archive] 图片归档异常: ${key}`, e);
      archiveFailCount++;
    }
  }
  if (archiveFailCount > 0) {
    console.warn(`[archive] 共 ${archiveFailCount}/${imageKeys.length} 张宫格图片归档失败`);
  }

  try {
    const refKeysRes = await fetch("/api/ref-image");
    if (refKeysRes.ok) {
      const { keys: refKeys } = await refKeysRes.json();
      if (Array.isArray(refKeys) && refKeys.length > 0) {
        const refDataRes = await fetch(`/api/ref-image?keys=${encodeURIComponent(refKeys.join(","))}`);
        if (refDataRes.ok) {
          const { images: refData } = await refDataRes.json();
          if (refData) {
            for (const [rk, rv] of Object.entries(refData)) {
              if (rv) {
                archiveImages[`archive:${projectId}:ref:${rk}`] = rv as string;
                imageKeys.push(`ref:${rk}`);
              }
            }
          }
        }
      }
    }
  } catch { /* ignore */ }

  // ★ 采集动态 KV 条目（智能分镜/节拍/运镜提示词 — 按集数存储的前缀型键）
  const dynamicKV: { key: string; value: string }[] = [];
  const dynamicPrefixes = [
    "feicai-smart-nine-prompts-",
    "feicai-beat-prompts-",
    "feicai-motion-prompts-",
    "feicai-custom-grid-prompts-",
  ];
  for (const pfx of dynamicPrefixes) {
    try {
      const keys = await kvKeysByPrefix(pfx);
      for (const k of keys) {
        const v = await kvLoad(k);
        if (v) dynamicKV.push({ key: k, value: v });
      }
    } catch { /* ignore */ }
  }
  // 单独归档 smart-analysis-result（无前缀模式，单键）
  try {
    const sar = await kvLoad("feicai-smart-analysis-result");
    if (sar) dynamicKV.push({ key: "feicai-smart-analysis-result", value: sar });
  } catch { /* ignore */ }

  return {
    studioState,
    strippedConsistency: stripConsistencyImages(consistency),
    pipelineState,
    systemPrompts,
    videoStates,
    episode: String(episode),
    episodeCount,
    outputFiles,
    imageKeys,
    archiveImages,
    dynamicKV,
  };
}

// ── Archive current workspace ──

export async function archiveCurrentWorkspace(projectName: string, parentId?: string): Promise<ArchivedProject> {
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const snapshot = await takeWorkspaceSnapshot(id);

  if (Object.keys(snapshot.archiveImages).length > 0) {
    try {
      await saveGridImagesDB(snapshot.archiveImages);
    } catch (e) {
      console.error("[archive] IDB 保存图片失败（可能配额不足）:", e);
      // 继续创建项目元数据，但图片可能不完整
    }
  }

  const project: ArchivedProject = {
    id,
    name: projectName,
    episode: snapshot.episode,
    episodeCount: snapshot.episodeCount,
    createdAt: now,
    updatedAt: now,
    studioState: snapshot.studioState as Record<string, unknown> | null,
    consistency: snapshot.strippedConsistency,
    pipelineState: snapshot.pipelineState,
    systemPrompts: snapshot.systemPrompts,
    videoStates: snapshot.videoStates,
    imageKeys: snapshot.imageKeys,
    outputFiles: snapshot.outputFiles,
    imageCount: snapshot.imageKeys.filter(k => !k.startsWith("ref:")).length,
    dynamicKV: snapshot.dynamicKV,
    version: 1,
    parentId: parentId || undefined,
  };

  const projects = await loadProjects();
  projects.unshift(project);
  await saveProjects(projects);
  // ★ 不调用 setActiveProjectId：archive 后总是紧跟 doReset()，
  //   若此处切换磁盘指针到新项目 ID，doReset 会删空目录而遗漏旧图片。
  //   磁盘指针保持不变，让 clearCurrentWorkspace 正确删除当前目录。

  // ★ 同步保存到磁盘文件（outputs/projects/{id}/metadata.json）
  await saveProjectToDisk(project);

  return project;
}

// ── Overwrite existing archived project ──

export async function overwriteProject(projectId: string): Promise<ArchivedProject | null> {
  const projects = await loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return null;

  const existing = projects[idx];
  const now = new Date().toISOString();

  // ★ 崩溃安全：先保存新数据，再清理旧数据（避免 delete→crash→全丢）
  // 1. 先采集新快照（旧数据仍完好）
  const snapshot = await takeWorkspaceSnapshot(projectId);

  // 2. 保存新归档图片（upsert 模式，同 key 直接覆盖）
  if (Object.keys(snapshot.archiveImages).length > 0) {
    try {
      await saveGridImagesDB(snapshot.archiveImages);
    } catch (e) {
      console.error("[archive] IDB 覆盖保存图片失败（可能配额不足）:", e);
    }
  }

  // 3. 清理旧快照中多余的 key（仅删除新快照不包含的）
  const prefix = `archive:${projectId}:`;
  const oldKeys = await loadGridImageKeysByFilterDB(k => k.startsWith(prefix));
  const newKeySet = new Set(Object.keys(snapshot.archiveImages));
  for (const key of oldKeys) {
    if (!newKeySet.has(key)) {
      await deleteGridImageDB(key);
    }
  }

  // 更新项目元数据（保留 id/name/createdAt/parentId/tags/description）
  const updated: ArchivedProject = {
    ...existing,
    updatedAt: now,
    version: (existing.version || 1) + 1,
    episode: snapshot.episode,
    episodeCount: snapshot.episodeCount,
    studioState: snapshot.studioState as Record<string, unknown> | null,
    consistency: snapshot.strippedConsistency,
    pipelineState: snapshot.pipelineState,
    systemPrompts: snapshot.systemPrompts,
    videoStates: snapshot.videoStates,
    imageKeys: snapshot.imageKeys,
    outputFiles: snapshot.outputFiles,
    imageCount: snapshot.imageKeys.filter(k => !k.startsWith("ref:")).length,
    dynamicKV: snapshot.dynamicKV,
  };

  projects[idx] = updated;
  await saveProjects(projects);
  // ★ 不调用 setActiveProjectId：overwrite 后总是紧跟 doReset()，
  //   若此处切换磁盘指针，doReset 会删空目录而遗漏旧图片。

  // ★ 同步保存到磁盘文件
  await saveProjectToDisk(updated);

  return updated;
}

// ── Restore archived project to workspace ──

export async function restoreProject(projectId: string): Promise<boolean> {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return false;

  // 1. Clear current workspace（删除旧项目的磁盘图片 + 清除磁盘项目标识）
  await clearCurrentWorkspace();

  // ★ 2. 项目隔离关键：在恢复图片之前，先将磁盘项目标识切换到目标项目
  //   这样后续 saveGridImagesToDisk → POST /api/local-file → resolveDir("grid-images")
  //   会写入到 grid-images/{projectId}/ 而不是 grid-images/_default/
  await syncProjectIdToDisk(projectId);

  // ★ 2.5 清理目标项目目录残留（防止历史 Bug 遗留的幽灵图片/文件）
  try {
    await fetch("/api/local-file?category=grid-images", { method: "DELETE" });
    console.log(`[restore] ✓ 已清理目标目录 grid-images/${projectId}/ 残留`);
  } catch { /* ignore */ }
  try {
    await fetch("/api/outputs", { method: "DELETE" });
    console.log(`[restore] ✓ 已清理目标目录 prompts/${projectId}/ 残留`);
  } catch { /* ignore */ }

  // 3. Restore text data to IndexedDB
  if (project.studioState) {
    await kvSet("feicai-studio-state", JSON.stringify(project.studioState));
  }
  if (project.consistency) {
    await saveConsistency(project.consistency);
  }
  if (project.pipelineState) {
    await kvSet("feicai-pipeline-state", project.pipelineState);
  }
  if (project.systemPrompts) {
    await kvSet("feicai-system-prompts", project.systemPrompts);
  }
  if (project.videoStates) {
    // 恢复时清除视频卡片（视频文件未归档，避免残留指向已删文件的坏引用）
    try {
      const parsed = JSON.parse(project.videoStates);
      for (const ep of Object.keys(parsed)) {
        if (parsed[ep]?.videoCards) parsed[ep].videoCards = [];
        if (parsed[ep]?.activeCardId) parsed[ep].activeCardId = "";
      }
      await kvSet("feicai-video-states", JSON.stringify(parsed));
    } catch {
      await kvSet("feicai-video-states", project.videoStates);
    }
  }

  // 4. Restore images from IDB archive → save to disk（★ 此时磁盘标识已指向目标项目）
  const prefix = `archive:${projectId}:`;
  const archivedImages = await loadGridImagesByFilterDB(k => k.startsWith(prefix));
  const restoredImages: Record<string, string> = {};
  const restoredRefImages: Record<string, string> = {};

  for (const [key, value] of Object.entries(archivedImages)) {
    if (!value) continue; // 跳过 null/空值（归档时 FileReader 失败的残留）
    const originalKey = key.slice(prefix.length);
    if (originalKey.startsWith("ref:")) {
      // 一致性参考图 → 恢复到 ref-images/ 目录
      restoredRefImages[originalKey.slice(4)] = value; // 去掉 "ref:" 前缀
    } else {
      restoredImages[originalKey] = value;
    }
  }

  if (Object.keys(restoredImages).length > 0) {
    await saveGridImagesToDisk(restoredImages);
  }

  // 4.5 恢复一致性参考图到 ref-images/
  let refRestoreFailCount = 0;
  for (const [refKey, dataUrl] of Object.entries(restoredRefImages)) {
    try {
      const refRes = await fetch("/api/ref-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: refKey, imageData: dataUrl }),
      });
      if (!refRes.ok) {
        console.warn(`[restore] 参考图恢复失败: ${refKey} → HTTP ${refRes.status}`);
        refRestoreFailCount++;
      }
    } catch (e) {
      console.warn(`[restore] 参考图恢复异常: ${refKey}`, e);
      refRestoreFailCount++;
    }
  }
  if (refRestoreFailCount > 0) {
    console.warn(`[restore] 共 ${refRestoreFailCount}/${Object.keys(restoredRefImages).length} 张参考图恢复失败`);
  }

  // 5. Restore output files to server
  if (project.outputFiles && project.outputFiles.length > 0) {
    try {
      await fetch("/api/outputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: project.outputFiles }),
      });
    } catch { /* ignore if server unavailable */ }
  }

  // 5.5 ★ 恢复动态 KV 条目（智能分镜/节拍/运镜提示词 + 分析结果）
  if (project.dynamicKV && project.dynamicKV.length > 0) {
    for (const entry of project.dynamicKV) {
      try {
        await kvSet(entry.key, entry.value);
      } catch (e) {
        console.warn(`[restore] 动态KV恢复失败: ${entry.key}`, e);
      }
    }
    console.log(`[restore] ✓ 已恢复 ${project.dynamicKV.length} 条动态KV条目`);
  }

  // 6. 设置活跃项目（IndexedDB + 磁盘双写，磁盘文件已在 step 2 提前设置）
  await setActiveProjectId(projectId);

  return true;
}

// ── Delete archived project ──

export async function deleteProject(projectId: string): Promise<void> {
  // 1. Remove archived images from IndexedDB（只加载 key 列表，不加载 value，避免 OOM）
  const prefix = `archive:${projectId}:`;
  const keysToDelete = await loadGridImageKeysByFilterDB(k => k.startsWith(prefix));

  for (const key of keysToDelete) {
    await deleteGridImageDB(key);
  }

  // 2. ★ 清理磁盘上该项目的 grid-images 目录残留（若存在）
  try {
    // 临时切到目标项目 → 删除其目录内容 → 切回原来
    const currentRes = await fetch("/api/active-project");
    const { projectId: currentId } = currentRes.ok ? await currentRes.json() : { projectId: null };
    await syncProjectIdToDisk(projectId);
    await fetch("/api/local-file?category=grid-images", { method: "DELETE" });
    await fetch("/api/outputs", { method: "DELETE" });
    // 恢复原来的磁盘指针
    await syncProjectIdToDisk(currentId === projectId ? null : currentId);
    console.log(`[deleteProject] ✓ 已清理磁盘 grid-images/${projectId}/ + prompts/${projectId}/ 目录`);
  } catch (e) {
    console.warn(`[deleteProject] 磁盘清理失败:`, e);
  }

  // 3. Remove from projects list
  const projects = await loadProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  await saveProjects(filtered);
}

// ── Clear current workspace (without archiving) ──

export async function clearCurrentWorkspace(): Promise<void> {
  // ★ 项目隔离关键时序：先删除当前项目的磁盘图片（磁盘文件仍指向旧项目），
  //   再清除磁盘项目标识 → 新会话回退到 _default 目录。
  //   顺序不可颠倒，否则会删错目录。

  // ── Step 1: 删除当前项目的磁盘宫格图片（此时磁盘文件仍指向旧项目 → 删对目录）──
  try {
    await fetch("/api/local-file?category=grid-images", { method: "DELETE" });
    console.log("[clearWorkspace] ✓ 已清除当前项目的磁盘宫格图片");
  } catch (e) {
    console.warn("[clearWorkspace] 清除磁盘宫格图片失败:", e);
  }

  // ── Step 1.5: 删除当前项目的输出文件（.md 提示词，同样需在指针切换前执行）──
  try {
    await fetch("/api/outputs", { method: "DELETE" });
    console.log("[clearWorkspace] ✓ 已清除当前项目的输出文件");
  } catch (e) {
    console.warn("[clearWorkspace] 清除输出文件失败:", e);
  }

  // ── Step 2: 清除磁盘项目标识 → 后续请求回退到 _default ──
  await syncProjectIdToDisk(null);

  // ── Step 3: 清除 IndexedDB 活跃项目跟踪 ──
  await clearActiveProjectId();

  // ── Step 4: Clear state from IndexedDB ──
  await Promise.all([
    kvRemove("feicai-studio-state"),
    kvRemove("feicai-consistency"),
    kvRemove("feicai-pipeline-state"),
    kvRemove("feicai-system-prompts"),
    kvRemove("feicai-video-states"),
    // 清理所有动态提示词（按 episode/beat 分散存储）
    kvRemoveByPrefix("feicai-motion-prompts-"),
    // ★ 清理智能分镜分析结果 + 各集九宫格提示词
    kvRemove("feicai-smart-analysis-result"),
    kvRemoveByPrefix("feicai-smart-nine-prompts-"),
    // ★ 清理节拍拆解 EP 标记（第八十七次修复配套）
    kvRemoveByPrefix("feicai-beat-prompts-"),
    // ★ 清理自定义宫格提示词
    kvRemoveByPrefix("feicai-custom-grid-prompts-"),
  ]);

  // ── Step 5: Also clear any remaining localStorage keys ──
  try { localStorage.removeItem("feicai-studio-state"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-consistency"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-pipeline-state"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-system-prompts"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-video-states"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-video-active-ep"); } catch { /* ignore */ };
  // ★ 清理旧章节/剧本选择残留（防止新项目提取时使用旧项目的章节内容）
  try { localStorage.removeItem("feicai-pipeline-script-chapter"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-pipeline-script-id"); } catch { /* ignore */ }
  // ★ 清理剧本管理页面持久化状态（防止新项目仍定位到旧章节）
  try { localStorage.removeItem("feicai-scripts-active-id"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-scripts-chapter-id"); } catch { /* ignore */ }
  // ★ 清理跨页面信号键（防止旧项目残留污染新项目）
  try { localStorage.removeItem("feicai-studio-smart-mode"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-studio-smart-auto-gen"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-pipeline-tab"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-style-sync-ts"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-image-gen-mode"); } catch { /* ignore */ }
  try { localStorage.removeItem("feicai-new-project"); } catch { /* ignore */ }
  // Note: feicai-scripts (剧本管理) is intentionally preserved
  // Note: feicai-video-models (模型配置) is intentionally preserved
  // Note: feicai-settings (LLM/API 设置) is intentionally preserved
  // Note: feicai-gemini-tab-settings (Gemini Tab 配置) is intentionally preserved
  // Note: feicai-gemini-tab-warning-dismissed (用户偏好) is intentionally preserved
}

// ── Helpers ──

function safeJsonParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function stripConsistencyImages(profile: ConsistencyProfile): ConsistencyProfile {
  const clone: ConsistencyProfile = JSON.parse(JSON.stringify(profile));
  // Strip data URLs (they're archived in IndexedDB separately)
  if (clone.style?.styleImage?.startsWith("data:")) {
    clone.style.styleImage = "";
  }
  for (const list of [clone.characters, clone.scenes, clone.props] as { referenceImage?: string }[][]) {
    for (const item of list) {
      if (item.referenceImage?.startsWith("data:")) {
        item.referenceImage = "";
      }
    }
  }
  return clone;
}

/**
 * Check if the current workspace has any meaningful data worth archiving.
 */
export async function hasWorkspaceData(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Check if there's any studio state or consistency data in IndexedDB
  const studioState = await kvLoad("feicai-studio-state");
  const consistency = await kvLoad("feicai-consistency");
  const videoStates = await kvLoad("feicai-video-states");
  const hasState = !!studioState || !!consistency || !!videoStates;
  return hasState;
}
