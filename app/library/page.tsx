/**
 * 角色库管理页面
 *
 * 功能：
 * - 管理当前工作台 + 所有归档项目的角色/场景/道具
 * - 当前工作台条目可增删改（与生图工作台一致性面板双向同步）
 * - 归档项目条目只读浏览
 * - 参考图上传、搜索、大图预览
 */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  User, Mountain, Sword, Search, Plus, Trash2, X, Loader,
  ZoomIn, Upload, Save, Package, ChevronDown, Edit3, CheckSquare,
  RefreshCw,
  ExternalLink, ArrowRightLeft, Check, ImagePlus, Bot, Sparkles,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import type { ConsistencyProfile, CharacterRef, SceneRef, PropRef } from "../lib/consistency";
import { deriveCharacterGrouping, loadConsistencyAsync, loadSystemPromptsAsync, saveConsistency, restoreConsistencyImagesFromDisk, isValidImageRef } from "../lib/consistency";
import { loadProjects, saveProjects, persistProjectToDisk, type ArchivedProject } from "../lib/projects";
import { buildStyleDatabasePromptParts, buildStyleDatabaseSummary } from "../lib/stylePresets";
import { isSoraModel, type SoraCharacter, type SoraCharCategory } from "../lib/zhenzhen/types";

// ─── 类型 ───

type TabKey = "characters" | "scenes" | "props";

interface DisplayItem {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  prompt?: string;
  referenceImage?: string;
  groupId?: string;
  groupBase?: string;
  subType?: string;
  /** 来源标识 */
  source: "current" | string; // "current" 或归档项目 ID
  sourceName: string;
  type: TabKey;
}

interface CharacterGroupView {
  key: string;
  groupBase: string;
  source: "current" | string;
  sourceName: string;
  items: DisplayItem[];
}

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "characters", label: "角色", icon: User },
  { key: "scenes", label: "场景", icon: Mountain },
  { key: "props", label: "道具", icon: Sword },
];

const ROLE_UPLOAD_SETTINGS_KEY = "feicai-sora-upload-config";
const VIDEO_MODELS_STORAGE_KEY = "feicai-video-models";
const SORA_CHARACTERS_STORAGE_KEY = "feicai-sora-characters";
const SORA_UPLOAD_RECORDS_KEY = "feicai-sora-uploaded-chars";

interface SoraUploadConfig {
  apiKey: string;
  baseUrl: string;
}

interface SoraUploadRecord {
  itemId: string;
  platform: "贞贞工坊";
  soraId: string;
  username: string;
  uploadedAt: number;
}

interface BatchUploadTask {
  itemId: string;
  itemName: string;
  platform: "贞贞工坊";
  status: "pending" | "uploading" | "success" | "error";
  progress: string;
  error?: string;
}

interface CostumeVariant {
  id: string;
  label: string;
  notes: string;
  prompt: string;
}

interface EntityMatchResult {
  id: string;
  name: string;
  score: number;
  reason: string;
}

interface EntityMatchSection {
  type: TabKey;
  label: string;
  results: Array<EntityMatchResult & { item: DisplayItem }>;
}

type LibraryImageGenMode = "api" | "geminiTab" | "jimeng";

const LIBRARY_IMAGE_MODE_KEY = "feicai-library-image-mode";

function loadSoraUploadRecords(): SoraUploadRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SORA_UPLOAD_RECORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSoraUploadRecords(records: SoraUploadRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SORA_UPLOAD_RECORDS_KEY, JSON.stringify(records));
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return readBlobAsDataUrl(file);
}

function toSoraCategory(tab: TabKey): SoraCharCategory {
  if (tab === "characters") return "character";
  if (tab === "scenes") return "scene";
  return "prop";
}

function resolveSoraUploadConfig(): SoraUploadConfig | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ROLE_UPLOAD_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { apiKey?: string; baseUrl?: string };
      if (parsed.apiKey) {
        return {
          apiKey: parsed.apiKey,
          baseUrl: (parsed.baseUrl || "https://ai.t8star.cn").replace(/\/+$/, ""),
        };
      }
    }
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem(VIDEO_MODELS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Array<{ apiKey?: string; model?: string; name?: string; url?: string }>;
    if (!Array.isArray(parsed)) return null;

    const soraPreset = parsed.find((item) => item.apiKey && isSoraModel(item.model || item.name || ""));
    if (soraPreset) {
      return {
        apiKey: soraPreset.apiKey!,
        baseUrl: (soraPreset.url || "https://ai.t8star.cn").replace(/\/+$/, ""),
      };
    }

    const zhenzhenPreset = parsed.find((item) => item.apiKey && (item.url || "").includes("t8star.cn"));
    if (zhenzhenPreset) {
      return {
        apiKey: zhenzhenPreset.apiKey!,
        baseUrl: (zhenzhenPreset.url || "https://ai.t8star.cn").replace(/\/+$/, ""),
      };
    }
  } catch {
    // ignore
  }

  return null;
}

// ─── nano-id 替代 ───
function nanoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLibraryImageMode(): LibraryImageGenMode {
  if (typeof window === "undefined") return "api";
  const raw = localStorage.getItem(LIBRARY_IMAGE_MODE_KEY);
  return raw === "geminiTab" || raw === "jimeng" ? raw : "api";
}

function sortCharacterStates(items: DisplayItem[]): DisplayItem[] {
  return [...items].sort((a, b) => {
    const aRank = a.subType ? 1 : 0;
    const bRank = b.subType ? 1 : 0;
    if (aRank !== bRank) return aRank - bRank;
    const bySubType = (a.subType || "").localeCompare(b.subType || "", "zh-CN");
    if (bySubType !== 0) return bySubType;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

// ═══════════════════════════════════════════════════════════
// ★ 模块级内存缓存 — 页面切换后再回来瞬间渲染
// ═══════════════════════════════════════════════════════════
interface LibraryCache {
  consistency: ConsistencyProfile | null;
  projects: ArchivedProject[];
  diskImages: Record<string, Record<string, string>>;
  idbCache: Record<string, Record<string, string>>;
  /** 缓存时间戳 */
  ts: number;
}
let _libraryCache: LibraryCache | null = null;

/** 快速加载（Phase 1: IDB 数据 + 磁盘 URL check，不做 IDB 全表扫描） */
async function loadLibraryFast(): Promise<LibraryCache> {
  const [rawProfile, projects] = await Promise.all([
    loadConsistencyAsync(),
    loadProjects(),
  ]);

  // ★ 恢复当前工作台参考图（用 URL 引用模式，无需传输图片数据）
  const profile = await restoreConsistencyImagesFromDisk(rawProfile);

  // ★ 批量恢复归档项目的磁盘参考图 — 轻量 check API
  const archivedIds: string[] = [];
  const idToProjectMap: Record<string, string[]> = {};
  for (const proj of projects) {
    if (!proj.consistency) continue;
    for (const list of [proj.consistency.characters, proj.consistency.scenes, proj.consistency.props]) {
      for (const item of (list || []) as Array<{ id: string; referenceImage?: string }>) {
        if (item.id && (!item.referenceImage || item.referenceImage === "")) {
          if (!idToProjectMap[item.id]) {
            archivedIds.push(item.id);
            idToProjectMap[item.id] = [];
          }
          idToProjectMap[item.id].push(proj.id);
        }
      }
    }
  }

  const diskImages: Record<string, Record<string, string>> = {};
  if (archivedIds.length > 0) {
    try {
      const checkRes = await fetch(`/api/ref-image?keys=${encodeURIComponent(archivedIds.join(","))}&check=1`);
      if (checkRes.ok) {
        const { exists } = await checkRes.json();
        for (const itemId of archivedIds) {
          if (exists?.[itemId]) {
            const url = `/api/ref-image?serve=${itemId}`;
            for (const projId of idToProjectMap[itemId] || []) {
              if (!diskImages[projId]) diskImages[projId] = {};
              diskImages[projId][itemId] = url;
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Library] 归档磁盘图片检查失败:", e);
    }
  }

  const cache: LibraryCache = {
    consistency: profile,
    projects,
    diskImages,
    idbCache: {},   // IDB 全表扫描推迟到用户手动同步
    ts: Date.now(),
  };
  _libraryCache = cache;
  return cache;
}

/** 深度加载（Phase 2: 额外 IDB 全表扫描归档图片，仅手动同步时调用） */
async function loadLibraryDeep(base: LibraryCache): Promise<LibraryCache> {
  const idbCache: Record<string, Record<string, string>> = {};
  try {
    const { loadGridImagesByFilterDB } = await import("../lib/imageDB");
    const archivePrefix = "archive:";
    const refInfix = ":ref:";
    const allArchiveImages = await loadGridImagesByFilterDB(
      (k: string) => k.startsWith(archivePrefix) && k.includes(refInfix)
    );
    for (const [k, v] of Object.entries(allArchiveImages)) {
      const afterPrefix = k.slice(archivePrefix.length);
      const refIdx = afterPrefix.indexOf(refInfix);
      if (refIdx === -1) continue;
      const projId = afterPrefix.slice(0, refIdx);
      const itemId = afterPrefix.slice(refIdx + refInfix.length);
      if (!idbCache[projId]) idbCache[projId] = {};
      idbCache[projId][itemId] = v;
    }
    console.log(`[Library] IDB 归档图片深度加载: ${Object.keys(allArchiveImages).length} 条`);
  } catch (e) {
    console.warn("[Library] IDB 归档图片加载失败:", e);
  }

  const updated: LibraryCache = {
    ...base,
    // ★ 重新加载最新数据（防止手动同步时数据过期）
    consistency: base.consistency,
    projects: base.projects,
    idbCache,
    ts: Date.now(),
  };
  _libraryCache = updated;
  return updated;
}

// ═══════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════

export default function LibraryPage() {
  // ── 标签页 ──
  const [activeTab, setActiveTab] = useState<TabKey>("characters");

  // ── 数据源 ──
  const [consistency, setConsistency] = useState<ConsistencyProfile | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProject[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 搜索 ──
  const [searchQuery, setSearchQuery] = useState("");

  // ── 来源筛选 ──
  const [sourceFilter, setSourceFilter] = useState<"all" | "current" | string>("current");
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);

  // ── 新增弹窗 ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", description: "", prompt: "" });
  const [addImageFile, setAddImageFile] = useState<string>(""); // data URL
  const addImageInputRef = useRef<HTMLInputElement>(null);

  // ── 编辑弹窗 ──
  const [editingItem, setEditingItem] = useState<DisplayItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", prompt: "" });
  const [editImageFile, setEditImageFile] = useState<string>("");
  const editImageInputRef = useRef<HTMLInputElement>(null);
  const batchImageInputRef = useRef<HTMLInputElement>(null);

  // ── 多选模式 ──
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);

  // ── 大图预览 ──
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  // ── 保存中 ──
  const [saving, setSaving] = useState(false);

  // ── 后台同步状态 ──
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(_libraryCache?.ts || 0);
  const [batchImporting, setBatchImporting] = useState(false);
  const [soraUploads, setSoraUploads] = useState<SoraUploadRecord[]>([]);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [batchUploadRunning, setBatchUploadRunning] = useState(false);
  const [batchUploadTasks, setBatchUploadTasks] = useState<BatchUploadTask[]>([]);
  const [showBatchUploadModal, setShowBatchUploadModal] = useState(false);
  const [costumeItem, setCostumeItem] = useState<DisplayItem | null>(null);
  const [costumeNotes, setCostumeNotes] = useState("");
  const [costumeVariants, setCostumeVariants] = useState<CostumeVariant[]>([]);
  const [costumeLoading, setCostumeLoading] = useState(false);
  const [costumeApplyingId, setCostumeApplyingId] = useState<string | null>(null);
  const [costumeLockComposition, setCostumeLockComposition] = useState(true);
  const [showEntityMatchModal, setShowEntityMatchModal] = useState(false);
  const [entityMatchText, setEntityMatchText] = useState("");
  const [entityMatchLoading, setEntityMatchLoading] = useState(false);
  const [entityMatchError, setEntityMatchError] = useState("");
  const [entityMatchResults, setEntityMatchResults] = useState<EntityMatchSection[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [libraryImageGenMode, setLibraryImageGenMode] = useState<LibraryImageGenMode>("api");
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [batchGeneratingImages, setBatchGeneratingImages] = useState(false);

  // ── 归档项目图片缓存 ──
  // archiveDiskImages: 磁盘 serve URL（初始化时一次性批量检查）
  const [archiveDiskImages, setArchiveDiskImages] = useState<Record<string, Record<string, string>>>(_libraryCache?.diskImages || {});
  // archiveImageCache: IDB 备份 data URL（惰性加载）
  const [archiveImageCache, setArchiveImageCache] = useState<Record<string, Record<string, string>>>(_libraryCache?.idbCache || {});
  const [loadingArchiveId, setLoadingArchiveId] = useState<string | null>(null);

  // ── 加载数据（缓存优先 + 后台静默刷新） ──
  useEffect(() => {
    let cancelled = false;

    // ★ Phase 0: 如果有缓存，立刻渲染（0ms 延迟）
    if (_libraryCache) {
      setConsistency(_libraryCache.consistency);
      setArchivedProjects(_libraryCache.projects);
      setArchiveDiskImages(_libraryCache.diskImages);
      setArchiveImageCache(_libraryCache.idbCache);
      setLastSyncTime(_libraryCache.ts);
      setLoading(false);

      // 后台静默刷新（不阻塞 UI）
      loadLibraryFast().then(cache => {
        if (!cancelled) {
          setConsistency(cache.consistency);
          setArchivedProjects(cache.projects);
          setArchiveDiskImages(cache.diskImages);
          setLastSyncTime(cache.ts);
          console.log("[Library] 后台静默刷新完成");
        }
      }).catch(err => console.warn("[Library] 后台刷新失败:", err));
      return () => { cancelled = true; };
    }

    // ★ Phase 1: 首次加载（无缓存）
    setLoading(true);
    loadLibraryFast().then(cache => {
      if (!cancelled) {
        setConsistency(cache.consistency);
        setArchivedProjects(cache.projects);
        setArchiveDiskImages(cache.diskImages);
        setArchiveImageCache(cache.idbCache);
        setLastSyncTime(cache.ts);
        setLoading(false);
        console.log("[Library] 首次加载完成");
      }
    }).catch(err => {
      console.error("[Library] 加载失败:", err);
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSoraUploads(loadSoraUploadRecords());
  }, []);

  useEffect(() => {
    setLibraryImageGenMode(loadLibraryImageMode());
  }, []);

  // ── 手动同步（深度加载 = 快速加载 + IDB 全表扫描） ──
  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      // Phase 1: 快速刷新
      const fastCache = await loadLibraryFast();
      setConsistency(fastCache.consistency);
      setArchivedProjects(fastCache.projects);
      setArchiveDiskImages(fastCache.diskImages);

      // Phase 2: 深度 IDB 扫描
      const deepCache = await loadLibraryDeep(fastCache);
      setArchiveImageCache(deepCache.idbCache);
      setLastSyncTime(deepCache.ts);
      console.log("[Library] 手动同步完成（含深度 IDB 扫描）");
    } catch (err) {
      console.error("[Library] 同步失败:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // ── 监听 Studio 一致性数据变更（通过 CustomEvent 桥接） ──
  useEffect(() => {
    const handler = () => {
      loadConsistencyAsync()
        .then((raw) => restoreConsistencyImagesFromDisk(raw))
        .then((profile) => {
          setConsistency(profile);
          // 同时更新模块缓存
          if (_libraryCache) _libraryCache.consistency = profile;
        })
        .catch(() => {});
    };
    // Studio 保存时可能触发的 storage 事件
    window.addEventListener("storage", handler);
    window.addEventListener("feicai-consistency-updated", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("feicai-consistency-updated", handler);
    };
  }, []);

  // ── 持久化（保存到 KV + 触发 Studio 同步） ──
  const persistConsistency = useCallback(async (updated: ConsistencyProfile) => {
    setSaving(true);
    try {
      setConsistency(updated);
      await saveConsistency(updated);
      // 通知其他页面（如 Studio）数据已更新
      window.dispatchEvent(new CustomEvent("feicai-consistency-updated"));
    } catch (err) {
      console.error("[Library] 保存失败:", err);
    } finally {
      setSaving(false);
    }
  }, []);

  // ── 构建展示列表 ──
  const allItems = useMemo(() => {
    const items: DisplayItem[] = [];

    // 当前工作台
    if (consistency) {
      for (const c of consistency.characters) {
        items.push({ ...c, source: "current", sourceName: "当前工作台", type: "characters" });
      }
      for (const s of consistency.scenes) {
        items.push({ ...s, source: "current", sourceName: "当前工作台", type: "scenes" });
      }
      for (const p of consistency.props) {
        items.push({ ...p, source: "current", sourceName: "当前工作台", type: "props" });
      }
    }

    // 归档项目
    for (const proj of archivedProjects) {
      if (!proj.consistency) continue;
      const projName = proj.name || "未命名项目";
      for (const c of proj.consistency.characters || []) {
        // ★ 优先级：磁盘 serve URL → IDB data URL → 归档时残存的 referenceImage → 空
        const img = archiveDiskImages[proj.id]?.[c.id] || archiveImageCache[proj.id]?.[c.id] || c.referenceImage || "";
        items.push({ ...c, referenceImage: img, source: proj.id, sourceName: projName, type: "characters" });
      }
      for (const s of proj.consistency.scenes || []) {
        const img = archiveDiskImages[proj.id]?.[s.id] || archiveImageCache[proj.id]?.[s.id] || s.referenceImage || "";
        items.push({ ...s, referenceImage: img, source: proj.id, sourceName: projName, type: "scenes" });
      }
      for (const p of proj.consistency.props || []) {
        const img = archiveDiskImages[proj.id]?.[p.id] || archiveImageCache[proj.id]?.[p.id] || p.referenceImage || "";
        items.push({ ...p, referenceImage: img, source: proj.id, sourceName: projName, type: "props" });
      }
    }

    return items;
  }, [consistency, archivedProjects, archiveDiskImages, archiveImageCache]);

  // ── 惰性加载单个归档项目的 IDB 图片（仅在用户筛选到特定项目时触发） ──
  const loadArchiveImages = useCallback(async (projectId: string) => {
    if (archiveImageCache[projectId] || loadingArchiveId === projectId) return;
    setLoadingArchiveId(projectId);
    try {
      const { loadGridImagesByFilterDB } = await import("../lib/imageDB");
      const prefix = `archive:${projectId}:ref:`;
      const images = await loadGridImagesByFilterDB((k: string) => k.startsWith(prefix));
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(images)) {
        const itemKey = k.slice(prefix.length);
        mapped[itemKey] = v;
      }
      setArchiveImageCache((prev) => ({ ...prev, [projectId]: mapped }));
    } catch (err) {
      console.error("[Library] 加载归档图片失败:", err);
    } finally {
      setLoadingArchiveId(null);
    }
  }, [archiveImageCache, loadingArchiveId]);

  // 当切换到特定归档项目时，补充加载 IDB 图片（磁盘 + IDB 双重保障）
  useEffect(() => {
    if (sourceFilter !== "all" && sourceFilter !== "current") {
      loadArchiveImages(sourceFilter);
    }
  }, [sourceFilter, loadArchiveImages]);

  // ── 筛选 ──
  const filteredItems = useMemo(() => {
    let items = allItems.filter((i) => i.type === activeTab);

    // 来源筛选
    if (sourceFilter === "current") {
      items = items.filter((i) => i.source === "current");
    } else if (sourceFilter !== "all") {
      items = items.filter((i) => i.source === sourceFilter);
    }

    // 搜索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.aliases?.some((a) => a.toLowerCase().includes(q))
      );
    }

    return items;
  }, [allItems, activeTab, sourceFilter, searchQuery]);

  const entityMatchScopeItems = useMemo(() => {
    if (sourceFilter === "current") {
      return allItems.filter((item) => item.source === "current");
    }
    if (sourceFilter === "all") {
      return allItems;
    }
    return allItems.filter((item) => item.source === sourceFilter);
  }, [allItems, sourceFilter]);

  const entityMatchCandidates = useMemo(() => {
    const split = {
      characters: [] as DisplayItem[],
      scenes: [] as DisplayItem[],
      props: [] as DisplayItem[],
    };
    for (const item of entityMatchScopeItems) {
      split[item.type].push(item);
    }
    return split;
  }, [entityMatchScopeItems]);

  const entityMatchScopeStats = useMemo(() => ({
    characters: entityMatchCandidates.characters.length,
    scenes: entityMatchCandidates.scenes.length,
    props: entityMatchCandidates.props.length,
  }), [entityMatchCandidates]);

  const costumeDesignContext = useMemo(() => {
    const styleDatabaseSummary = buildStyleDatabaseSummary(consistency?.style || {});
    const worldSetting = [
      consistency?.style.timeSetting,
      consistency?.style.artStyle,
      consistency?.style.colorPalette,
      styleDatabaseSummary,
      consistency?.style.stylePresetLabel ? `${consistency.style.stylePresetEmoji || ""}${consistency.style.stylePresetLabel}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const stylePrompt = [
      consistency?.style.stylePrompt,
      consistency?.style.additionalNotes,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      styleDatabaseSummary,
      worldSetting,
      stylePrompt,
    };
  }, [consistency]);

  const characterGroupedView = useMemo(() => {
    if (activeTab !== "characters") {
      return { groups: [] as CharacterGroupView[], ungrouped: filteredItems };
    }

    const grouped = new Map<string, CharacterGroupView>();
    const ungrouped: DisplayItem[] = [];

    for (const item of filteredItems) {
      const derived = deriveCharacterGrouping(item.name);
      const groupId = item.groupId || derived.groupId;
      const groupBase = item.groupBase || derived.groupBase;
      const subType = item.subType || derived.subType;
      const normalizedItem = (groupId || groupBase || subType)
        ? { ...item, groupId, groupBase, subType }
        : item;

      if (!groupId && !groupBase) {
        ungrouped.push(normalizedItem);
        continue;
      }

      const bucketKey = `${normalizedItem.source}::${groupId || groupBase}`;
      const bucket = grouped.get(bucketKey) || {
        key: bucketKey,
        groupBase: groupBase || normalizedItem.name,
        source: normalizedItem.source,
        sourceName: normalizedItem.sourceName,
        items: [],
      };
      bucket.items.push(normalizedItem);
      grouped.set(bucketKey, bucket);
    }

    const groups: CharacterGroupView[] = [];
    for (const bucket of grouped.values()) {
      const sortedItems = sortCharacterStates(bucket.items);
      const shouldGroup = sortedItems.length > 1 || sortedItems.some((item) => item.subType);
      if (!shouldGroup) {
        ungrouped.push(...sortedItems);
        continue;
      }
      groups.push({ ...bucket, items: sortedItems });
    }

    groups.sort((a, b) => {
      if (a.source === b.source) return a.groupBase.localeCompare(b.groupBase, "zh-CN");
      if (a.source === "current") return -1;
      if (b.source === "current") return 1;
      return a.sourceName.localeCompare(b.sourceName, "zh-CN");
    });

    return {
      groups,
      ungrouped: sortCharacterStates(ungrouped),
    };
  }, [activeTab, filteredItems]);

  // ── 统计 ──
  const stats = useMemo(() => {
    const current = { characters: 0, scenes: 0, props: 0 };
    const total = { characters: 0, scenes: 0, props: 0 };
    for (const item of allItems) {
      total[item.type]++;
      if (item.source === "current") current[item.type]++;
    }
    return { current, total };
  }, [allItems]);

  // ── 来源列表 ──
  const sourceOptions = useMemo(() => {
    const opts: { id: string; label: string; count: number }[] = [
      { id: "all", label: "全部来源", count: allItems.filter((i) => i.type === activeTab).length },
      { id: "current", label: "当前工作台", count: stats.current[activeTab] },
    ];
    for (const proj of archivedProjects) {
      if (!proj.consistency) continue;
      const list = proj.consistency[activeTab] || [];
      if (list.length > 0) {
        opts.push({ id: proj.id, label: proj.name || "未命名项目", count: list.length });
      }
    }
    return opts;
  }, [archivedProjects, allItems, activeTab, stats]);

  const tabLabel = TABS.find((tab) => tab.key === activeTab)?.label || "";
  const currentSourceLabel = sourceOptions.find((option) => option.id === sourceFilter)?.label || "全部来源";

  const currentUploadCandidates = useMemo(
    () =>
      filteredItems.filter(
        (item) => item.source === "current" && isValidImageRef(item.referenceImage)
      ),
    [filteredItems]
  );

  const toggleCharacterGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);

  const getSoraUploadRecord = useCallback(
    (itemId: string) => soraUploads.find((item) => item.itemId === itemId && item.platform === "贞贞工坊"),
    [soraUploads]
  );

  const openEntityMatchModal = useCallback(() => {
    setShowEntityMatchModal(true);
    setEntityMatchError("");
    if (!entityMatchText.trim() && searchQuery.trim()) {
      setEntityMatchText(searchQuery.trim());
    }
  }, [entityMatchText, searchQuery]);

  const closeEntityMatchModal = useCallback(() => {
    if (entityMatchLoading) return;
    setShowEntityMatchModal(false);
  }, [entityMatchLoading]);

  const handleFocusMatchedItem = useCallback((type: TabKey, item: DisplayItem) => {
    setActiveTab(type);
    setSourceFilter(item.source === "current" ? "current" : item.source);
    setSourceDropdownOpen(false);
    setSearchQuery(item.name);
    setShowEntityMatchModal(false);
  }, []);

  const handleRunEntityMatch = useCallback(async () => {
    const text = entityMatchText.trim();
    if (!text) {
      setEntityMatchError("请先输入要匹配的剧情、提示词或描述文本。");
      setEntityMatchResults([]);
      return;
    }

    if (entityMatchScopeItems.length === 0) {
      setEntityMatchError("当前来源范围内没有可匹配的角色、场景或道具。");
      setEntityMatchResults([]);
      return;
    }

    setEntityMatchLoading(true);
    setEntityMatchError("");
    try {
      const res = await fetch("/api/entity-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          limit: 6,
          characters: entityMatchCandidates.characters.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
          scenes: entityMatchCandidates.scenes.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
          props: entityMatchCandidates.props.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        characters?: EntityMatchResult[];
        scenes?: EntityMatchResult[];
        props?: EntityMatchResult[];
      };
      if (!res.ok) {
        throw new Error(data.error || "实体匹配失败");
      }

      const itemMaps = {
        characters: new Map(entityMatchCandidates.characters.map((item) => [item.id, item])),
        scenes: new Map(entityMatchCandidates.scenes.map((item) => [item.id, item])),
        props: new Map(entityMatchCandidates.props.map((item) => [item.id, item])),
      };

      const orderedTabs = [
        activeTab,
        ...TABS.map((tab) => tab.key).filter((key) => key !== activeTab),
      ] as TabKey[];

      const sections = orderedTabs.map((key) => {
        const label = TABS.find((tab) => tab.key === key)?.label || key;
        const rawResults = Array.isArray(data[key]) ? data[key]! : [];
        const results = rawResults
          .map((result) => {
            const item = itemMaps[key].get(result.id);
            return item ? { ...result, item } : null;
          })
          .filter((result): result is EntityMatchResult & { item: DisplayItem } => Boolean(result));
        return { type: key, label, results };
      }).filter((section) => section.results.length > 0);

      setEntityMatchResults(sections);
      if (sections.length === 0) {
        setEntityMatchError("没有找到明显匹配的角色、场景或道具，可以尝试换一段更具体的文本。");
      }
    } catch (error) {
      setEntityMatchResults([]);
      setEntityMatchError(error instanceof Error ? error.message : "实体匹配失败");
    } finally {
      setEntityMatchLoading(false);
    }
  }, [activeTab, entityMatchCandidates, entityMatchScopeItems.length, entityMatchText]);

  useEffect(() => {
    if (!showEntityMatchModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleRunEntityMatch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRunEntityMatch, showEntityMatchModal]);

  const persistSoraUpload = useCallback((sourceItem: DisplayItem, character: SoraCharacter) => {
    const cachedChars = (() => {
      try {
        return JSON.parse(localStorage.getItem(SORA_CHARACTERS_STORAGE_KEY) || "[]") as SoraCharacter[];
      } catch {
        return [];
      }
    })();
    const nextChars = [...cachedChars.filter((item) => item.id !== character.id), character];
    localStorage.setItem(SORA_CHARACTERS_STORAGE_KEY, JSON.stringify(nextChars));

    setSoraUploads((prev) => {
      const next = [
        ...prev.filter((item) => !(item.itemId === sourceItem.id && item.platform === "贞贞工坊")),
        {
          itemId: sourceItem.id,
          platform: "贞贞工坊",
          soraId: character.id,
          username: character.username,
          uploadedAt: Date.now(),
        } satisfies SoraUploadRecord,
      ];
      saveSoraUploadRecords(next);
      return next;
    });
  }, []);

  const resolveUploadImageData = useCallback(async (referenceImage: string) => {
    if (referenceImage.startsWith("/api/")) {
      const res = await fetch(referenceImage);
      if (!res.ok) throw new Error("参考图读取失败");
      const blob = await res.blob();
      return readBlobAsDataUrl(blob);
    }
    return referenceImage;
  }, []);

  const createSoraCharacter = useCallback(async (item: DisplayItem, config?: SoraUploadConfig) => {
    const uploadConfig = config ?? resolveSoraUploadConfig();
    if (!uploadConfig) {
      throw new Error("请先在设置页配置 Sora 系列模型（含 API Key）");
    }
    if (!item.referenceImage || !isValidImageRef(item.referenceImage)) {
      throw new Error("该条目没有参考图，无法上传");
    }

    const imageData = await resolveUploadImageData(item.referenceImage);
    const res = await fetch("/api/zhenzhen/img2char", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: uploadConfig.apiKey,
        baseUrl: uploadConfig.baseUrl || undefined,
        imageData,
        category: toSoraCategory(item.type),
        nickname: item.name,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `上传失败 (${res.status})`);
    }

    const data = await res.json();
    return {
      id: data.id || `char-${Date.now()}`,
      username: data.username || item.name,
      profilePicture: data.profile_picture_url || "",
      permalink: data.permalink || "",
      createdAt: Date.now(),
      category: toSoraCategory(item.type),
      nickname: item.name,
      fromVideoUrl: data.videoUrl || "",
      fromTaskId: data.taskId || "",
    } satisfies SoraCharacter;
  }, [resolveUploadImageData]);

  const currentWorkspaceItems = useMemo(
    () => allItems.filter((item) => item.type === activeTab && item.source === "current"),
    [allItems, activeTab]
  );

  const currentMissingImageCandidates = useMemo(
    () => currentWorkspaceItems.filter((item) => !isValidImageRef(item.referenceImage)),
    [currentWorkspaceItems]
  );

  const setLibraryImageMode = useCallback((mode: LibraryImageGenMode) => {
    setLibraryImageGenMode(mode);
    try {
      localStorage.setItem(LIBRARY_IMAGE_MODE_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const patchCurrentItem = useCallback(async (itemId: string, listKey: TabKey, patch: Partial<CharacterRef | SceneRef | PropRef>) => {
    if (!consistency) return;
    const updated: ConsistencyProfile = {
      ...consistency,
      characters: [...consistency.characters],
      scenes: [...consistency.scenes],
      props: [...consistency.props],
      style: { ...consistency.style },
    };
    const list = [...updated[listKey]];
    const idx = list.findIndex((entry) => entry.id === itemId);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch } as CharacterRef & SceneRef & PropRef;
    updated[listKey] = list as typeof updated[typeof listKey];
    await persistConsistency(updated);
  }, [consistency, persistConsistency]);

  const setGeneratingForItem = useCallback((itemId: string, active: boolean) => {
    setGeneratingImageIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const readImageSettings = useCallback(() => {
    try {
      const raw = localStorage.getItem("feicai-settings");
      return raw ? JSON.parse(raw) as Record<string, string> : {};
    } catch {
      return {} as Record<string, string>;
    }
  }, []);

  const ensureDataUrl = useCallback(async (imageUrl: string) => {
    if (imageUrl.startsWith("data:")) return imageUrl;
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error("图片读取失败");
    const blob = await res.blob();
    return readBlobAsDataUrl(blob);
  }, []);

  const ensureGeminiTabReady = useCallback(async () => {
    const headers: Record<string, string> = {};
    try {
      const raw = localStorage.getItem("feicai-gemini-tab-settings");
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed.serviceUrl) headers["x-gemini-tab-url"] = parsed.serviceUrl;
    } catch {
      // ignore
    }

    try {
      const probe = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/browser")}`, { headers });
      if (probe.ok) {
        const data = await probe.json().catch(() => null);
        if (data?.reachable) return true;
      }
    } catch {
      // continue to start service
    }

    const startRes = await fetch("/api/gemini-tab/start-service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!startRes.ok) return false;

    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const check = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/browser")}`, { headers });
        if (!check.ok) continue;
        const data = await check.json().catch(() => null);
        if (data?.reachable) return true;
      } catch {
        // keep waiting
      }
    }

    return false;
  }, []);

  const buildLibraryImagePrompt = useCallback((item: DisplayItem) => {
    const style = consistency?.style;
    const styleDatabaseParts = buildStyleDatabasePromptParts(style || {});
    const styleDatabaseSummary = buildStyleDatabaseSummary(style || {});
    const styleHints = [
      style?.artStyle ? `整体画风：${style.artStyle}` : "",
      style?.colorPalette ? `色彩基调：${style.colorPalette}` : "",
      style?.stylePresetLabel ? `风格预设：${style.stylePresetEmoji || "✨"}${style.stylePresetLabel}` : "",
      styleDatabaseSummary ? `风格数据库：${styleDatabaseSummary}` : "",
      ...styleDatabaseParts,
      style?.timeSetting ? `时代/世界观：${style.timeSetting}` : "",
      style?.stylePrompt ? `风格提示：${style.stylePrompt}` : "",
      style?.additionalNotes ? `补充要求：${style.additionalNotes}` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const basePrompt = item.prompt?.trim() || "";
    const brief = [item.name, item.description].filter(Boolean).join("，");

    if (item.type === "characters") {
      return [
        basePrompt || `${brief}，角色设定参考图`,
        item.subType ? `${item.groupBase || item.name} · ${item.subType}` : "",
        "single character design sheet, full body, premium concept art, clean background, expressive costume details",
        "match current workspace style system, preserve consistent face, costume logic, silhouette language, and visual identity",
        styleHints,
        "no text, no watermark, no subtitle",
      ].filter(Boolean).join(", ");
    }

    if (item.type === "scenes") {
      return [
        basePrompt || `${brief}，场景设定参考图`,
        "environment concept sheet, cinematic wide shot, strong spatial layout, high detail lighting",
        "match current workspace style system, preserve worldbuilding consistency, atmosphere continuity, and production-design language",
        styleHints,
        "no text, no watermark, no subtitle",
      ].filter(Boolean).join(", ");
    }

    return [
      basePrompt || `${brief}，道具设定参考图`,
      "prop design sheet, centered composition, product concept render, high detail material study",
      "match current workspace style system, preserve material language, craftsmanship detail, and silhouette readability",
      styleHints,
      "no text, no watermark, no subtitle",
    ].filter(Boolean).join(", ");
  }, [consistency]);

  const persistGeneratedImage = useCallback(async (item: DisplayItem, generatedImage: string) => {
    if (!consistency || item.source !== "current") {
      throw new Error("仅支持更新当前工作台条目");
    }

    const dataUrl = await ensureDataUrl(generatedImage);
    const postRes = await fetch("/api/ref-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: item.id, imageData: dataUrl }),
    });
    if (!postRes.ok) {
      const body = await postRes.json().catch(() => ({}));
      throw new Error(body.error || "保存生成图片失败");
    }

    const imageRef = `/api/ref-image?serve=${encodeURIComponent(item.id)}&_t=${Date.now()}`;
    const updated = { ...consistency };
    updated[item.type] = updated[item.type].map((entry: CharacterRef & SceneRef & PropRef) =>
      entry.id === item.id ? { ...entry, referenceImage: imageRef } : entry
    );
    await persistConsistency(updated);
    return imageRef;
  }, [consistency, ensureDataUrl, persistConsistency]);

  const generateImageForItem = useCallback(async (item: DisplayItem, silent = false) => {
    if (item.source !== "current") {
      throw new Error("仅支持当前工作台条目生成");
    }

    const prompt = buildLibraryImagePrompt(item);
    const settings = readImageSettings();
    const aspectRatio = item.type === "characters" ? "9:16" : item.type === "props" ? "1:1" : (consistency?.style?.aspectRatio || settings["img-aspect-ratio"] || "16:9");
    const imageSize = consistency?.style?.resolution || settings["img-size"] || "2K";
    const styleRefs = consistency?.style?.styleImage && isValidImageRef(consistency.style.styleImage)
      ? [consistency.style.styleImage]
      : [];

    if (libraryImageGenMode === "api") {
      const apiKey = settings["img-key"];
      if (!apiKey) throw new Error("请先在设置页配置图像 API Key");

      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl: settings["img-url"],
          model: settings["img-model"],
          prompt,
          referenceImages: styleRefs.length > 0 ? styleRefs : undefined,
          imageSize,
          aspectRatio,
          format: settings["img-format"] || "gemini",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "图像生成失败");
      const generated = data.images?.[0] || "";
      if (!generated) throw new Error("未拿到生成图片");
      await persistGeneratedImage(item, generated);
      if (!silent) alert(`✅ 已为「${item.name}」生成参考图`);
      return;
    }

    if (libraryImageGenMode === "geminiTab") {
      const ok = await ensureGeminiTabReady();
      if (!ok) throw new Error("Gemini Tab 服务未就绪");

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      let geminiMode = "pro";
      let downloadMode = "manual";
      try {
        const raw = localStorage.getItem("feicai-gemini-tab-settings");
        const parsed = raw ? JSON.parse(raw) : {};
        if (parsed.serviceUrl) headers["x-gemini-tab-url"] = parsed.serviceUrl;
        if (parsed.geminiMode) geminiMode = parsed.geminiMode;
        if (parsed.downloadMode) downloadMode = parsed.downloadMode;
      } catch {
        // ignore
      }

      const res = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/generate")}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tasks: [{
            taskId: `library-${Date.now()}-${item.id}`,
            prompt,
            referenceImages: styleRefs.length > 0 ? styleRefs : undefined,
            mode: geminiMode,
            downloadMode,
          }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gemini Tab 生成失败");
      const generated = data.results?.[0]?.imageBase64 || "";
      if (!generated) throw new Error(data.results?.[0]?.error || "未拿到生成图片");
      await persistGeneratedImage(item, generated);
      if (!silent) alert(`✅ 已为「${item.name}」生成参考图`);
      return;
    }

    const seedanceRaw = localStorage.getItem("feicai-seedance-settings");
    const seedanceSettings = seedanceRaw ? JSON.parse(seedanceRaw) as Record<string, string> : {};
    const sessionId = String(seedanceSettings.sessionId || "");
    const webId = String(seedanceSettings.webId || "");
    const userId = String(seedanceSettings.userId || "");
    const rawCookies = String(seedanceSettings.jimengRawCookies || "");
    if (!sessionId || !webId || !userId) {
      throw new Error("请先在 Seedance 页面配置即梦凭证");
    }

    let jimengModel = "seedream-5.0";
    let jimengResolution = imageSize === "4K" ? "4K" : "2K";
    try {
      const stateRes = await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "load-page-state" }),
      });
      const stateData = await stateRes.json().catch(() => ({}));
      if (stateRes.ok && stateData.state) {
        jimengModel = stateData.state.model || jimengModel;
        jimengResolution = stateData.state.resolution || jimengResolution;
      }
    } catch {
      // ignore
    }

    const startRes = await fetch("/api/jimeng-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate",
        prompt: prompt.slice(0, 1200),
        model: jimengModel,
        ratio: aspectRatio,
        resolution: jimengResolution,
        count: 1,
        sessionId,
        webId,
        userId,
        rawCookies: rawCookies || undefined,
        referenceImages: styleRefs.length > 0 ? styleRefs : undefined,
      }),
    });
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok || !startData.taskId) throw new Error(startData.error || "即梦任务创建失败");

    let generatedUrl = "";
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const statusRes = await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskId: startData.taskId }),
      });
      const statusData = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) throw new Error(statusData.error || "即梦状态查询失败");
      if (statusData.status === "done") {
        generatedUrl = statusData.results?.[0] || "";
        break;
      }
      if (statusData.status === "error") {
        throw new Error(statusData.error || "即梦生成失败");
      }
    }
    if (!generatedUrl) throw new Error("即梦生成超时，请稍后在即梦页查看结果");

    await persistGeneratedImage(item, generatedUrl);
    if (!silent) alert(`✅ 已为「${item.name}」生成参考图`);
  }, [buildLibraryImagePrompt, consistency, ensureGeminiTabReady, libraryImageGenMode, persistGeneratedImage, readImageSettings]);

  const handleGenerateSingleImage = useCallback(async (item: DisplayItem) => {
    if (generatingImageIds.has(item.id)) return;
    setGeneratingForItem(item.id, true);
    try {
      await generateImageForItem(item);
    } catch (error) {
      alert(error instanceof Error ? error.message : "生成失败");
    } finally {
      setGeneratingForItem(item.id, false);
    }
  }, [generateImageForItem, generatingImageIds, setGeneratingForItem]);

  const handleBatchFillMissingImages = useCallback(async () => {
    if (currentMissingImageCandidates.length === 0) {
      alert(`当前${tabLabel}没有缺图条目`);
      return;
    }
    if (!confirm(`将为当前工作台缺图的 ${currentMissingImageCandidates.length} 个${tabLabel}依次生成参考图，确定继续吗？`)) {
      return;
    }

    setBatchGeneratingImages(true);
    try {
      for (const item of currentMissingImageCandidates) {
        setGeneratingForItem(item.id, true);
        try {
          await generateImageForItem(item, true);
        } catch (error) {
          console.warn("[Library] 批量生图失败:", item.name, error);
        } finally {
          setGeneratingForItem(item.id, false);
        }
      }
      alert(`✅ 当前工作台缺图${tabLabel}已批量处理完成`);
    } finally {
      setBatchGeneratingImages(false);
    }
  }, [currentMissingImageCandidates, generateImageForItem, setGeneratingForItem, tabLabel]);

  // ── 新增条目 ──
  const handleAdd = useCallback(async () => {
    if (!consistency || !addForm.name.trim()) return;
    const id = `${activeTab === "characters" ? "char" : activeTab === "scenes" ? "scene" : "prop"}-${nanoId()}`;

    // ★ 先保存图片到磁盘（在 persistConsistency 之前）
    let imgRef = "";
    if (addImageFile && addImageFile.startsWith("data:")) {
      try {
        console.log(`[Library:handleAdd] 上传参考图: key=${id}, dataUrl长度=${addImageFile.length}`);
        const postRes = await fetch("/api/ref-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: id, imageData: addImageFile }),
        });
        const postBody = await postRes.json().catch(() => null);
        if (!postRes.ok) {
          console.error(`[Library:handleAdd] 参考图上传失败: status=${postRes.status}`, postBody);
          imgRef = addImageFile; // 降级：使用 data URL
        } else {
          console.log(`[Library:handleAdd] 参考图上传成功:`, postBody);
          // ★ URL 引用 + 时间戳破缓存
          imgRef = `/api/ref-image?serve=${encodeURIComponent(id)}&_t=${Date.now()}`;
        }
      } catch (err) {
        console.error("[Library:handleAdd] 保存参考图失败(网络err):", err);
        imgRef = addImageFile; // 降级：使用 data URL
      }
    }

    const newItem = {
      id,
      name: addForm.name.trim(),
      description: addForm.description.trim(),
      prompt: addForm.prompt.trim(),
      referenceImage: imgRef,
      aliases: [],
      ...(activeTab === "characters" ? deriveCharacterGrouping(addForm.name.trim()) : {}),
    };

    const updated = { ...consistency };
    updated[activeTab] = [...updated[activeTab], newItem as CharacterRef & SceneRef & PropRef];
    await persistConsistency(updated);

    setShowAddModal(false);
    setAddForm({ name: "", description: "", prompt: "" });
    setAddImageFile("");
  }, [consistency, addForm, addImageFile, activeTab, persistConsistency]);

  // ── 删除条目（支持当前工作台 + 归档项目） ──
  const handleDelete = useCallback(async (item: DisplayItem) => {
    if (!confirm(`确定要删除「${item.name}」吗？\n\n此操作不可恢复。`)) return;

    // ★ 同时清理磁盘参考图文件
    try {
      await fetch(`/api/ref-image?key=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } catch { /* 忽略磁盘清理失败 */ }

    if (item.source === "current") {
      // 当前工作台条目
      if (!consistency) return;
      const updated = { ...consistency };
      updated[item.type] = updated[item.type].filter((i: { id: string }) => i.id !== item.id);
      await persistConsistency(updated);
    } else {
      // ★ 归档项目条目：从归档数据中移除
      try {
        const projects = await loadProjects();
        const proj = projects.find(p => p.id === item.source);
        if (proj?.consistency) {
          const listKey = item.type as keyof Pick<ConsistencyProfile, "characters" | "scenes" | "props">;
          proj.consistency[listKey] = (proj.consistency[listKey] || []).filter(
            (i: { id: string }) => i.id !== item.id
          ) as typeof proj.consistency[typeof listKey];
          await saveProjects(projects);
          // ★ 同步到磁盘
          persistProjectToDisk(proj).catch(() => {});
          // 刷新本地归档数据
          setArchivedProjects([...projects]);
        }
      } catch (err) {
        console.error("[Library] 删除归档条目失败:", err);
      }
    }
  }, [consistency, persistConsistency]);

  // ── 编辑条目（当前工作台 + 归档项目均可编辑） ──
  // ── 批量删除 ──
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`确定要删除选中的 ${count} 个条目吗？\n\n此操作不可恢复。`)) return;
    const itemsToDelete = filteredItems.filter(i => selectedIds.has(`${i.source}-${i.id}`));
    // 按来源分组
    const currentItems = itemsToDelete.filter(i => i.source === "current");
    const archivedMap = new Map<string, DisplayItem[]>();
    for (const item of itemsToDelete) {
      if (item.source !== "current") {
        const list = archivedMap.get(item.source) || [];
        list.push(item);
        archivedMap.set(item.source, list);
      }
    }
    // 清理磁盘参考图
    for (const item of itemsToDelete) {
      try {
        await fetch(`/api/ref-image?key=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      } catch { /* 忽略 */ }
    }
    // 删除当前工作台条目
    if (currentItems.length > 0 && consistency) {
      const deleteIds = new Set(currentItems.map(i => i.id));
      const updated = { ...consistency };
      for (const listKey of ["characters", "scenes", "props"] as const) {
        updated[listKey] = updated[listKey].filter((i: { id: string }) => !deleteIds.has(i.id));
      }
      await persistConsistency(updated);
    }
    // 删除归档项目条目
    if (archivedMap.size > 0) {
      try {
        const projects = await loadProjects();
        for (const [projId, items] of archivedMap) {
          const proj = projects.find(p => p.id === projId);
          if (!proj?.consistency) continue;
          const deleteIds = new Set(items.map(i => i.id));
          for (const listKey of ["characters", "scenes", "props"] as const) {
            (proj.consistency as unknown as Record<string, { id: string }[]>)[listKey] = (proj.consistency[listKey] || []).filter(
              (i: { id: string }) => !deleteIds.has(i.id)
            );
          }
          persistProjectToDisk(proj).catch(() => {});
        }
        await saveProjects(projects);
        setArchivedProjects([...projects]);
      } catch (err) {
        console.error("[Library] 批量删除归档条目失败:", err);
      }
    }
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, [selectedIds, filteredItems, consistency, persistConsistency]);

  // ── 编辑条目（当前工作台 + 归档项目均可编辑） ──
  const openEdit = useCallback((item: DisplayItem) => {
    setEditingItem(item);
    setEditForm({ name: item.name, description: item.description, prompt: item.prompt || "" });
    setEditImageFile(item.referenceImage || "");
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingItem || !editForm.name.trim()) return;
    const nextCharacterGrouping = editingItem.type === "characters"
      ? deriveCharacterGrouping(editForm.name.trim())
      : null;

    // ★ 先保存图片到磁盘
    let imgRef = editImageFile;
    if (editImageFile && editImageFile.startsWith("data:")) {
      try {
        console.log(`[Library:handleEditSave] 上传参考图: key=${editingItem.id}, dataUrl长度=${editImageFile.length}`);
        const postRes = await fetch("/api/ref-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: editingItem.id, imageData: editImageFile }),
        });
        const postBody = await postRes.json().catch(() => null);
        if (!postRes.ok) {
          console.error(`[Library:handleEditSave] 参考图上传失败: status=${postRes.status}`, postBody);
        } else {
          console.log(`[Library:handleEditSave] 参考图上传成功:`, postBody);
          imgRef = `/api/ref-image?serve=${encodeURIComponent(editingItem.id)}&_t=${Date.now()}`;
        }
      } catch (err) {
        console.error("[Library:handleEditSave] 保存参考图失败(网络err):", err);
      }
    } else {
      console.log(`[Library:handleEditSave] 无需上传图片: editImageFile=${editImageFile ? editImageFile.substring(0, 60) + '...' : '(empty)'}`);
    }

    if (editingItem.source === "current") {
      // ★ 当前工作台条目
      if (!consistency) return;
      const updated = { ...consistency };
      updated[editingItem.type] = updated[editingItem.type].map((i: CharacterRef & SceneRef & PropRef) => {
        if (i.id !== editingItem.id) return i;
        return {
          ...i,
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          prompt: editForm.prompt.trim(),
          referenceImage: imgRef,
          ...(editingItem.type === "characters"
            ? {
                groupId: nextCharacterGrouping?.groupId,
                groupBase: nextCharacterGrouping?.groupBase,
                subType: nextCharacterGrouping?.subType,
              }
            : {}),
        };
      });
      await persistConsistency(updated);
    } else {
      // ★ 归档项目条目：更新归档数据
      try {
        const projects = await loadProjects();
        const proj = projects.find(p => p.id === editingItem.source);
        if (proj?.consistency) {
          const listKey = editingItem.type as keyof Pick<ConsistencyProfile, "characters" | "scenes" | "props">;
          proj.consistency[listKey] = (proj.consistency[listKey] || []).map(
            (i: { id: string; name?: string; description?: string; prompt?: string; referenceImage?: string; groupId?: string; groupBase?: string; subType?: string }) => {
              if (i.id !== editingItem.id) return i;
              return {
                ...i,
                name: editForm.name.trim(),
                description: editForm.description.trim(),
                prompt: editForm.prompt.trim(),
                referenceImage: imgRef,
                ...(editingItem.type === "characters"
                  ? {
                      groupId: nextCharacterGrouping?.groupId,
                      groupBase: nextCharacterGrouping?.groupBase,
                      subType: nextCharacterGrouping?.subType,
                    }
                  : {}),
              };
            }
          ) as typeof proj.consistency[typeof listKey];
          await saveProjects(projects);
          // ★ 同步到磁盘
          persistProjectToDisk(proj).catch(() => {});
          // 刷新本地归档数据
          setArchivedProjects([...projects]);
          // 更新磁盘图片缓存（若上传了新图）
          if (imgRef && imgRef.startsWith("/api/ref-image?serve=")) {
            setArchiveDiskImages(prev => ({
              ...prev,
              [editingItem.source]: { ...(prev[editingItem.source] || {}), [editingItem.id]: imgRef }
            }));
          }
        }
      } catch (err) {
        console.error("[Library] 编辑归档条目失败:", err);
      }
    }

    setEditingItem(null);
  }, [editingItem, consistency, editForm, editImageFile, persistConsistency]);

  // ── 图片文件选择 ──
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, target: "add" | "edit") => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("图片不得超过 10MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (target === "add") setAddImageFile(dataUrl);
      else setEditImageFile(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleBatchImportImages = useCallback(async (files: FileList) => {
    if (!consistency || files.length === 0) return;

    setBatchImporting(true);
    try {
      const itemsToAdd: Array<CharacterRef | SceneRef | PropRef> = [];
      const prefix = activeTab === "characters" ? "char" : activeTab === "scenes" ? "scene" : "prop";

      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 50 * 1024 * 1024) {
          alert(`图片 ${file.name} 超过 50MB，已跳过`);
          continue;
        }

        const id = `${prefix}-${nanoId()}`;
        const name = file.name.replace(/\.[^/.]+$/, "");
        const dataUrl = await readFileAsDataUrl(file);

        let imgRef = dataUrl;
        try {
          const postRes = await fetch("/api/ref-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: id, imageData: dataUrl }),
          });
          if (postRes.ok) {
            imgRef = `/api/ref-image?serve=${encodeURIComponent(id)}&_t=${Date.now()}`;
          }
        } catch {
          // keep data URL fallback
        }

        itemsToAdd.push({
          id,
          name,
          description: "",
          prompt: "",
          referenceImage: imgRef,
          aliases: [],
          ...(activeTab === "characters" ? deriveCharacterGrouping(name) : {}),
        });
      }

      if (itemsToAdd.length === 0) return;

      const updated = { ...consistency };
      updated[activeTab] = [...updated[activeTab], ...itemsToAdd as Array<CharacterRef & SceneRef & PropRef>];
      await persistConsistency(updated);
      alert(`✅ 成功导入 ${itemsToAdd.length} 个${tabLabel}`);
    } finally {
      setBatchImporting(false);
    }
  }, [activeTab, consistency, persistConsistency, tabLabel]);

  const handleMoveItem = useCallback(async (item: DisplayItem, targetTab: TabKey) => {
    if (item.type === targetTab) return;

    const nextCharacterGrouping = targetTab === "characters"
      ? deriveCharacterGrouping(item.name)
      : null;

    const movedItem = {
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: item.prompt || "",
      referenceImage: item.referenceImage,
      aliases: item.aliases || [],
      ...(targetTab === "characters"
        ? {
            groupId: nextCharacterGrouping?.groupId,
            groupBase: nextCharacterGrouping?.groupBase,
            subType: nextCharacterGrouping?.subType,
          }
        : {}),
    } as CharacterRef & SceneRef & PropRef;

    if (item.source === "current") {
      if (!consistency) return;
      const updated = { ...consistency };
      updated[item.type] = updated[item.type].filter((entry: { id: string }) => entry.id !== item.id);
      updated[targetTab] = [...updated[targetTab], movedItem];
      await persistConsistency(updated);
    } else {
      try {
        const projects = await loadProjects();
        const proj = projects.find((entry) => entry.id === item.source);
        if (!proj?.consistency) return;
        proj.consistency[item.type] = proj.consistency[item.type].filter((entry: { id: string }) => entry.id !== item.id);
        proj.consistency[targetTab] = [...proj.consistency[targetTab], movedItem];
        await saveProjects(projects);
        persistProjectToDisk(proj).catch(() => {});
        setArchivedProjects([...projects]);
      } catch (err) {
        console.error("[Library] 移动归档条目失败:", err);
        return;
      }
    }

    setMoveMenuFor(null);
    alert(`已将「${item.name}」移动到${TABS.find((tab) => tab.key === targetTab)?.label || targetTab}`);
  }, [consistency, persistConsistency]);

  const handleUploadSingleToSora = useCallback(async (item: DisplayItem) => {
    const existing = getSoraUploadRecord(item.id);
    if (
      existing &&
      !confirm(`「${item.name}」已上传到贞贞工坊（@${existing.username}），是否重新上传？`)
    ) {
      return;
    }

    setUploadingItemId(item.id);
    try {
      const character = await createSoraCharacter(item);
      persistSoraUpload(item, character);
      alert(`✅ 「${item.name}」已成功上传到贞贞工坊-Sora\n@${character.username}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploadingItemId(null);
    }
  }, [createSoraCharacter, getSoraUploadRecord, persistSoraUpload]);

  const handleBatchUploadToSora = useCallback(async () => {
    if (currentUploadCandidates.length === 0) {
      alert(`当前${tabLabel}没有可上传的参考图`);
      return;
    }

    const config = resolveSoraUploadConfig();
    if (!config) {
      alert("请先在设置页配置 Sora 系列模型（含 API Key）");
      return;
    }

    if (!confirm(`将当前工作台有参考图的 ${currentUploadCandidates.length} 个${tabLabel} 批量上传到贞贞工坊 Sora 平台。\n\n确定继续？`)) {
      return;
    }

    setBatchUploadRunning(true);
    setShowBatchUploadModal(true);
    setBatchUploadTasks(currentUploadCandidates.map((item) => ({
      itemId: item.id,
      itemName: item.name,
      platform: "贞贞工坊",
      status: "pending",
      progress: "等待中",
    })));

    for (let index = 0; index < currentUploadCandidates.length; index++) {
      const item = currentUploadCandidates[index];
      setBatchUploadTasks((prev) =>
        prev.map((task, taskIndex) =>
          taskIndex === index
            ? { ...task, status: "uploading", progress: "上传参考图并生成角色中..." }
            : task
        )
      );

      try {
        const character = await createSoraCharacter(item, config);
        persistSoraUpload(item, character);
        setBatchUploadTasks((prev) =>
          prev.map((task, taskIndex) =>
            taskIndex === index
              ? { ...task, status: "success", progress: `✅ @${character.username}` }
              : task
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "未知错误";
        setBatchUploadTasks((prev) =>
          prev.map((task, taskIndex) =>
            taskIndex === index
              ? { ...task, status: "error", progress: "失败", error: message }
              : task
          )
        );
      }
    }

    setBatchUploadRunning(false);
  }, [createSoraCharacter, currentUploadCandidates, persistSoraUpload, tabLabel]);

  const closeCostumeModal = useCallback(() => {
    setCostumeItem(null);
    setCostumeNotes("");
    setCostumeVariants([]);
    setCostumeLoading(false);
    setCostumeApplyingId(null);
  }, []);

  const openCostumeDesign = useCallback(async (item: DisplayItem) => {
    setCostumeItem(item);
    setCostumeNotes(item.description || "");
    setCostumeVariants([]);
    setCostumeLockComposition(Boolean(item.referenceImage));
    setCostumeLoading(true);

    try {
      const prompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/costume-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: item.name,
          worldSetting: costumeDesignContext.worldSetting,
          outfitBrief: item.description || "",
          stylePrompt: costumeDesignContext.stylePrompt,
          lockComposition: Boolean(item.referenceImage),
          referenceHint: item.referenceImage ? `${item.name} existing reference sheet` : "",
          customPrompt: prompts.costumeDesignAgent || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "服装设计生成失败");
      setCostumeVariants(Array.isArray(data.variants) ? data.variants : []);
    } catch (err) {
      alert(err instanceof Error ? err.message : "服装设计生成失败");
    } finally {
      setCostumeLoading(false);
    }
  }, [costumeDesignContext]);

  const regenerateCostumeVariants = useCallback(async () => {
    if (!costumeItem) return;
    setCostumeLoading(true);
    try {
      const prompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/costume-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: costumeItem.name,
          worldSetting: costumeDesignContext.worldSetting,
          outfitBrief: costumeNotes || costumeItem.description || "",
          stylePrompt: costumeDesignContext.stylePrompt,
          lockComposition: costumeLockComposition,
          referenceHint: costumeItem.referenceImage ? `${costumeItem.name} existing reference sheet` : "",
          customPrompt: prompts.costumeDesignAgent || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "服装设计生成失败");
      setCostumeVariants(Array.isArray(data.variants) ? data.variants : []);
    } catch (err) {
      alert(err instanceof Error ? err.message : "服装设计生成失败");
    } finally {
      setCostumeLoading(false);
    }
  }, [costumeDesignContext, costumeItem, costumeLockComposition, costumeNotes]);

  const applyCostumeVariant = useCallback(async (variant: CostumeVariant, generateNow: boolean) => {
    if (!costumeItem) return;
    setCostumeApplyingId(variant.id);
    try {
      const suffix = costumeLockComposition && costumeItem.referenceImage
        ? "Preserve original composition, camera angle, character pose, framing, and background while replacing only the costume design."
        : "";
      const mergedPrompt = [variant.prompt, suffix].filter(Boolean).join(" ");
      const mergedDescription = [costumeItem.description, costumeNotes].filter(Boolean).join(" / ").trim() || variant.notes;
      await patchCurrentItem(costumeItem.id, "characters", {
        description: mergedDescription,
        prompt: mergedPrompt,
      });
      if (generateNow) {
        await handleGenerateSingleImage({
          ...costumeItem,
          description: mergedDescription,
          prompt: mergedPrompt,
        });
      }
      closeCostumeModal();
    } catch (err) {
      alert(err instanceof Error ? err.message : "应用服装方案失败");
    } finally {
      setCostumeApplyingId(null);
    }
  }, [closeCostumeModal, costumeItem, costumeLockComposition, costumeNotes, handleGenerateSingleImage, patchCurrentItem]);

  const renderItemCard = useCallback((item: DisplayItem) => {
    const isCurrent = item.source === "current";
    const itemKey = `${item.source}-${item.id}`;
    const isSelected = selectedIds.has(itemKey);

    return (
      <div
        key={itemKey}
        onClick={multiSelectMode ? () => {
          setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(itemKey)) next.delete(itemKey); else next.add(itemKey);
            return next;
          });
        } : undefined}
        className={`flex flex-col rounded-lg overflow-hidden border bg-[#171717] transition group ${
          multiSelectMode ? "cursor-pointer" : ""
        } ${
          isSelected
            ? "border-[var(--gold-primary)] ring-1 ring-[var(--gold-primary)]"
            : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
        }`}
      >
        <div className="relative w-full aspect-square bg-[#111]">
          {multiSelectMode && (
            <div className={`absolute top-2 left-2 z-10 flex items-center justify-center w-6 h-6 rounded border-2 transition ${
              isSelected
                ? "bg-[var(--gold-primary)] border-[var(--gold-primary)] text-[#0A0A0A]"
                : "bg-black/40 border-white/40 text-transparent"
            }`}>
              {isSelected && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          )}
          {item.referenceImage ? (
            <img
              src={item.referenceImage}
              alt={item.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget;
                img.style.display = "none";
                const placeholder = img.nextElementSibling as HTMLElement | null;
                if (placeholder) placeholder.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className="items-center justify-center w-full h-full text-[var(--text-muted)]"
            style={{ display: item.referenceImage ? "none" : "flex" }}
          >
            {(() => { const Icon = TABS.find((t) => t.key === activeTab)?.icon || User; return <Icon size={28} />; })()}
          </div>

          {!multiSelectMode && (
          <div className="absolute top-2 right-2 flex gap-1">
            {isCurrent && (
              <button
                onClick={(e) => { e.stopPropagation(); handleGenerateSingleImage(item); }}
                disabled={generatingImageIds.has(item.id)}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-cyan-300 hover:bg-cyan-500 hover:text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={item.referenceImage ? "重新生成参考图" : "一键生成参考图"}
              >
                {generatingImageIds.has(item.id) ? <Loader size={12} className="animate-spin" /> : <Bot size={11} />}
              </button>
            )}
            {isCurrent && item.type === "characters" && (
              <button
                onClick={(e) => { e.stopPropagation(); openCostumeDesign(item); }}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-amber-300 hover:bg-amber-500 hover:text-black transition cursor-pointer"
                title="服装设计"
              >
                <Sparkles size={11} />
              </button>
            )}
            {isCurrent && item.referenceImage && isValidImageRef(item.referenceImage) && (
              <button
                onClick={(e) => { e.stopPropagation(); handleUploadSingleToSora(item); }}
                disabled={uploadingItemId === item.id}
                className={`flex items-center justify-center w-7 h-7 rounded-full transition cursor-pointer ${
                  getSoraUploadRecord(item.id)
                    ? "bg-purple-600/80 text-white hover:bg-purple-600"
                    : "bg-black/60 text-purple-300 hover:bg-purple-600 hover:text-white"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={getSoraUploadRecord(item.id)
                  ? `已上传到贞贞工坊（@${getSoraUploadRecord(item.id)?.username}）点击重新上传`
                  : "上传到贞贞工坊-Sora"}
              >
                {uploadingItemId === item.id ? <Loader size={12} className="animate-spin" /> : <ExternalLink size={11} />}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(item); }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-white/70 hover:bg-[var(--gold-primary)] hover:text-black transition cursor-pointer"
              title="编辑"
            >
              <Edit3 size={12} />
            </button>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMoveMenuFor((prev) => prev === itemKey ? null : itemKey);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-white/70 hover:bg-blue-500 hover:text-white transition cursor-pointer"
                title="移动到其他分类"
              >
                <ArrowRightLeft size={11} />
              </button>
              {moveMenuFor === itemKey && (
                <div className="absolute z-30 top-full right-0 mt-1 min-w-[120px] bg-[#1A1A1A] border border-[var(--border-default)] rounded shadow-lg py-1">
                  {TABS.filter((tab) => tab.key !== item.type).map((tab) => {
                    const MoveIcon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveItem(item, tab.key);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--gold-primary)] transition cursor-pointer text-left"
                      >
                        <MoveIcon size={12} />
                        移至{tab.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-red-400 hover:bg-red-500 hover:text-white transition cursor-pointer"
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
          )}

          {item.referenceImage && (
            <button
              onClick={() => setPreviewImage({ url: item.referenceImage!, name: item.name })}
              className="absolute bottom-2 right-2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white/60 opacity-0 group-hover:opacity-100 hover:bg-black/80 hover:text-white transition cursor-pointer"
              title="放大查看"
            >
              <ZoomIn size={12} />
            </button>
          )}

          {!multiSelectMode && (
          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[9px] font-medium ${
            isCurrent
              ? "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]"
              : "bg-blue-500/20 text-blue-400"
          }`}>
            {isCurrent ? "当前" : "归档"}
          </div>
          )}
        </div>

        <div className="px-3 py-2.5 flex flex-col gap-1">
          <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{item.name}</p>
          {item.subType && (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center rounded-full border border-[var(--gold-primary)]/25 bg-[var(--gold-primary)]/10 px-2 py-0.5 text-[9px] text-[var(--gold-primary)]">
                {item.subType}
              </span>
              {item.groupBase && (
                <span className="text-[9px] text-[var(--text-muted)] truncate">基础设定：{item.groupBase}</span>
              )}
            </div>
          )}
          {item.description && (
            <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">{item.description}</p>
          )}
          {!isCurrent && (
            <p className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">
              来源: {item.sourceName}
            </p>
          )}
          {(() => {
            const upload = getSoraUploadRecord(item.id);
            if (!upload) return null;
            return (
              <div className="flex items-center gap-1 mt-0.5">
                <Check size={9} className="text-purple-400" />
                <span
                  className="text-[9px] text-purple-400 truncate"
                  title={`@${upload.username} · ${new Date(upload.uploadedAt).toLocaleString()}`}
                >
                  {upload.platform} · @{upload.username}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }, [
    activeTab,
    generatingImageIds,
    getSoraUploadRecord,
    handleDelete,
    handleGenerateSingleImage,
    handleMoveItem,
    handleUploadSingleToSora,
    multiSelectMode,
    openCostumeDesign,
    openEdit,
    selectedIds,
    uploadingItemId,
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ── 顶部标题栏 ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <Package size={20} className="text-[var(--gold-primary)]" />
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">角色库</h1>
            <span className="text-[12px] text-[var(--text-muted)] ml-2">
              管理所有项目的角色、场景、道具
            </span>
          </div>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--gold-primary)]">
                <Loader size={12} className="animate-spin" /> 保存中...
              </span>
            )}
            {/* 同步按钮 */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all
                border border-[var(--border-default)] hover:border-[var(--gold-primary)]
                text-[var(--text-muted)] hover:text-[var(--gold-primary)]
                disabled:opacity-50 disabled:cursor-not-allowed"
              title="同步刷新角色库数据（含深度 IDB 扫描）"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
              {syncing ? "同步中..." : "同步"}
            </button>
            {lastSyncTime > 0 && !syncing && (
              <span className="text-[10px] text-[var(--text-muted)] opacity-60">
                {Math.floor((Date.now() - lastSyncTime) / 1000) < 60
                  ? "刚刚同步"
                  : `${Math.floor((Date.now() - lastSyncTime) / 60000)}分钟前`}
              </span>
            )}
            {/* 统计 */}
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              <span>角色 <span className="text-[var(--text-secondary)]">{stats.current.characters}</span><span className="text-[var(--text-muted)]">/{stats.total.characters}</span></span>
              <span>场景 <span className="text-[var(--text-secondary)]">{stats.current.scenes}</span><span className="text-[var(--text-muted)]">/{stats.total.scenes}</span></span>
              <span>道具 <span className="text-[var(--text-secondary)]">{stats.current.props}</span><span className="text-[var(--text-muted)]">/{stats.total.props}</span></span>
            </div>
          </div>
        </header>

        {/* ── 工具栏 ── */}
        <div className="flex items-center gap-3 px-8 py-3 border-b border-[var(--border-default)] shrink-0">
          {/* 标签页 */}
          <div className="flex gap-1">
            {TABS.map(({ key, label, icon: Icon }) => {
              const count = filteredItems.filter((i) => i.type === key).length || allItems.filter((i) => i.type === key && (sourceFilter === "all" || i.source === sourceFilter || (sourceFilter === "current" && i.source === "current"))).length;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); setSelectedIds(new Set()); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded text-[12px] font-medium transition cursor-pointer ${
                    activeTab === key
                      ? "bg-[var(--gold-primary)]/15 text-[var(--gold-primary)] border border-[var(--gold-primary)]/30"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-default)]"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="w-px h-6 bg-[var(--border-default)]" />

          {/* 来源筛选 */}
          <div className="relative">
            <button
              onClick={() => setSourceDropdownOpen(!sourceDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer min-w-[140px]"
            >
              <span className="truncate">{currentSourceLabel}</span>
              <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ml-auto ${sourceDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {sourceDropdownOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 min-w-[200px] max-h-60 overflow-auto bg-[#1A1A1A] border border-[var(--border-default)] rounded shadow-lg">
                {sourceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setSourceFilter(opt.id); setSourceDropdownOpen(false); setSelectedIds(new Set()); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] text-left hover:bg-[var(--bg-surface)] transition cursor-pointer ${
                      sourceFilter === opt.id ? "text-[var(--gold-primary)] bg-[var(--gold-primary)]/5" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">{opt.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-default)] rounded p-0.5">
            {([
              { key: "api", label: "API" },
              { key: "geminiTab", label: "Gemini Tab" },
              { key: "jimeng", label: "即梦" },
            ] as Array<{ key: LibraryImageGenMode; label: string }>).map((mode) => (
              <button
                key={mode.key}
                onClick={() => setLibraryImageMode(mode.key)}
                className={`px-3 py-1.5 text-[11px] font-medium transition cursor-pointer ${
                  libraryImageGenMode === mode.key
                    ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                title={`角色库一键生图使用 ${mode.label} 模式`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleBatchFillMissingImages}
            disabled={batchGeneratingImages || currentMissingImageCandidates.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border-default)] rounded text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title={`一键补齐当前工作台缺图的${tabLabel}`}
          >
            {batchGeneratingImages ? <Loader size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            一键补齐缺图
            <span className="text-[10px] text-[var(--text-muted)]">({currentMissingImageCandidates.length})</span>
          </button>

          <button
            onClick={openEntityMatchModal}
            disabled={entityMatchScopeItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border-default)] rounded text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="粘贴一段剧情或提示词，快速匹配最相关的角色、场景、道具"
          >
            <Bot size={13} />
            智能匹配
          </button>

          <div className="flex-1" />

          {/* 多选按钮 */}
          {multiSelectMode ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-muted)]">
                已选 <span className="text-[var(--gold-primary)] font-medium">{selectedIds.size}</span> 项
              </span>
              <button
                onClick={() => {
                  // 全选/取消全选
                  if (selectedIds.size === filteredItems.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filteredItems.map(i => `${i.source}-${i.id}`)));
                  }
                }}
                className="px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              >
                {selectedIds.size === filteredItems.length ? "取消全选" : "全选"}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-red-500/80 text-white rounded hover:bg-red-500 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={11} />
                删除({selectedIds.size})
              </button>
              <button
                onClick={() => { setMultiSelectMode(false); setSelectedIds(new Set()); }}
                className="px-3 py-1.5 text-[11px] text-[var(--text-muted)] border border-[var(--border-default)] rounded hover:bg-[var(--bg-surface)] transition cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setMultiSelectMode(true); setSelectedIds(new Set()); }}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              title="多选模式"
            >
              <CheckSquare size={13} />
              多选
            </button>
          )}

          {/* 搜索 */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索名称..."
              className="pl-8 pr-3 py-2 w-48 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
            />
          </div>

          <button
            onClick={() => batchImageInputRef.current?.click()}
            disabled={batchImporting}
            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--gold-primary)] text-[12px] font-medium text-[var(--gold-primary)] rounded hover:bg-[var(--gold-primary)]/10 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {batchImporting ? <Loader size={13} className="animate-spin" /> : <ImagePlus size={14} />}
            {batchImporting ? "导入中..." : "批量导入图片"}
          </button>
          <input
            ref={batchImageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              if (e.target.files) handleBatchImportImages(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />

          {/* 新增按钮 */}
          <button
            onClick={() => { setShowAddModal(true); setAddForm({ name: "", description: "", prompt: "" }); setAddImageFile(""); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] rounded hover:brightness-110 transition cursor-pointer"
          >
            <Plus size={14} />
            新增{tabLabel}
          </button>

          <button
            onClick={handleBatchUploadToSora}
            disabled={batchUploadRunning || currentUploadCandidates.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600/80 text-[12px] font-medium text-white rounded hover:bg-purple-600 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="将当前工作台有参考图的条目批量上传到贞贞工坊 Sora 平台"
          >
            {batchUploadRunning ? <Loader size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            {batchUploadRunning ? "上传中..." : "一键上传 Sora"}
          </button>
        </div>

        {/* ── 内容区 ── */}
        <div className="flex-1 overflow-auto p-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--text-muted)]">
              <Loader size={24} className="animate-spin" />
              <span className="text-[13px]">加载中...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--text-muted)]">
              {(() => { const Icon = TABS.find((t) => t.key === activeTab)?.icon || User; return <Icon size={32} />; })()}
              <span className="text-[13px]">
                {searchQuery ? `未找到匹配的${tabLabel}` : `暂无${tabLabel}数据`}
              </span>
              {!searchQuery && sourceFilter === "current" && (
                <span className="text-[11px]">可在生图工作台通过 AI 提取添加，或点击上方「新增{tabLabel}」手动添加</span>
              )}
            </div>
          ) : activeTab === "characters" ? (
            <div className="flex flex-col gap-6">
              {characterGroupedView.groups.map((group) => {
                const isCollapsed = !!collapsedGroups[group.key];
                return (
                  <section
                    key={group.key}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-panel)]/55 p-4"
                  >
                    <button
                      onClick={() => toggleCharacterGroup(group.key)}
                      className="flex w-full items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex min-w-0 flex-col items-start gap-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{group.groupBase}</span>
                          <span className="rounded-full border border-[var(--gold-primary)]/20 bg-[var(--gold-primary)]/10 px-2 py-0.5 text-[10px] text-[var(--gold-primary)]">
                            {group.items.length} 个状态
                          </span>
                          {group.source !== "current" && (
                            <span className="text-[10px] text-[var(--text-muted)]">来源：{group.sourceName}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          多状态角色分组，适合管理同一角色的常态、战损态、觉醒态等变体
                        </p>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-[var(--text-muted)] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      />
                    </button>
                    {!isCollapsed && (
                      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {group.items.map(renderItemCard)}
                      </div>
                    )}
                  </section>
                );
              })}

              {characterGroupedView.ungrouped.length > 0 && (
                <section className="flex flex-col gap-3">
                  {characterGroupedView.groups.length > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">未分组角色</h2>
                        <p className="text-[11px] text-[var(--text-muted)]">未命中多状态命名规则的角色会保留在这里</p>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)]">{characterGroupedView.ungrouped.length} 个条目</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {characterGroupedView.ungrouped.map(renderItemCard)}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredItems.map(renderItemCard)}
            </div>
          )}
        </div>
      </main>

      {/* ── 新增弹窗 ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false); }}>
          <div className="flex flex-col gap-4 w-[480px] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">新增{tabLabel}</span>
              <button onClick={() => setShowAddModal(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
            </div>

            {/* 名称 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">名称 *</label>
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                placeholder={`输入${tabLabel}名称...`}
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">描述</label>
              <textarea
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                rows={3}
                placeholder={`描述${tabLabel}特征...`}
              />
            </div>

            {/* 英文提示词 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">英文提示词 (可选)</label>
              <textarea
                value={addForm.prompt}
                onChange={(e) => setAddForm((f) => ({ ...f, prompt: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none font-mono"
                rows={2}
                placeholder="English prompt for image generation..."
              />
            </div>

            {/* 参考图上传 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">参考图 (可选)</label>
              {addImageFile ? (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-[var(--border-default)] group/img">
                  <img
                    src={addImageFile}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={() => { console.warn("[Library:AddDialog] 图片预览加载失败"); setAddImageFile(""); }}
                  />
                  <div
                    onClick={() => addImageInputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover/img:opacity-100 transition cursor-pointer"
                  >
                    <Upload size={16} className="text-white/90" />
                    <span className="text-[10px] text-white/80">点击替换图片</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setAddImageFile(""); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500 transition cursor-pointer opacity-0 group-hover/img:opacity-100">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => addImageInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-3 border border-dashed border-[var(--border-default)] rounded text-[11px] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Upload size={14} />
                  点击上传参考图
                </button>
              )}
              <input ref={addImageInputRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "add")} className="hidden" />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 border border-[var(--border-default)] rounded text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                取消
              </button>
              <button onClick={handleAdd} disabled={!addForm.name.trim() || saving}
                className="flex items-center gap-1.5 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] rounded text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <Save size={14} />
                {saving ? "保存中..." : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑弹窗 ── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setEditingItem(null); }}>
          <div className="flex flex-col gap-4 w-[480px] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">编辑{tabLabel}</span>
              <button onClick={() => setEditingItem(null)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
            </div>

            {/* 名称 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">名称 *</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">描述</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                rows={3}
              />
            </div>

            {/* 英文提示词 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">英文提示词</label>
              <textarea
                value={editForm.prompt}
                onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none font-mono"
                rows={2}
              />
            </div>

            {/* 参考图 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">参考图</label>
              {editImageFile ? (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-[var(--border-default)] group/img">
                  <img
                    src={editImageFile}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={() => {
                      console.warn(`[Library:EditDialog] 图片预览加载失败: ${editImageFile.substring(0, 80)}`);
                      setEditImageFile("");
                    }}
                  />
                  {/* ★ hover 覆盖层：点击整个图片区域重新上传（仿生图工作台） */}
                  <div
                    onClick={() => editImageInputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover/img:opacity-100 transition cursor-pointer"
                  >
                    <Upload size={16} className="text-white/90" />
                    <span className="text-[10px] text-white/80">点击替换图片</span>
                  </div>
                  {/* 右上角清除按钮 */}
                  <button onClick={(e) => { e.stopPropagation(); setEditImageFile(""); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500 transition cursor-pointer opacity-0 group-hover/img:opacity-100">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => editImageInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-3 border border-dashed border-[var(--border-default)] rounded text-[11px] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Upload size={14} />
                  点击上传参考图
                </button>
              )}
              <input ref={editImageInputRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "edit")} className="hidden" />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setEditingItem(null)}
                className="flex-1 py-2.5 border border-[var(--border-default)] rounded text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                取消
              </button>
              <button onClick={handleEditSave} disabled={!editForm.name.trim() || saving}
                className="flex items-center gap-1.5 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] rounded text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <Save size={14} />
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 智能匹配弹窗 ── */}
      {showEntityMatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget && !entityMatchLoading) closeEntityMatchModal();
          }}
        >
          <div className="flex w-[880px] max-h-[82vh] flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-panel)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <div>
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">智能匹配</span>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  粘贴剧情、分镜描述或提示词，快速定位最匹配的角色、场景和道具。
                </p>
              </div>
              <button
                onClick={closeEntityMatchModal}
                disabled={entityMatchLoading}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
              <div className="flex flex-col gap-4 border-r border-[var(--border-default)] px-5 py-5">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]">匹配范围</div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--text-primary)]">{currentSourceLabel}</div>
                  <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                    当前优先展示：{TABS.find((tab) => tab.key === activeTab)?.label || "当前分类"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5">角色 {entityMatchScopeStats.characters}</span>
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5">场景 {entityMatchScopeStats.scenes}</span>
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5">道具 {entityMatchScopeStats.props}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-[var(--text-muted)]">待匹配文本</label>
                  <textarea
                    value={entityMatchText}
                    onChange={(e) => setEntityMatchText(e.target.value)}
                    rows={12}
                    placeholder={`例如：\n雨夜巷口，林骁穿黑色长风衣，手里握着旧式金属手枪，背后是闪烁霓虹与积水反光。`}
                    className="resize-none rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                  />
                  <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                    会优先命中实体名称、别名和描述关键词。建议输入 1-3 句关键描述，效果更稳定。
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {searchQuery.trim() && (
                      <button
                        onClick={() => setEntityMatchText(searchQuery.trim())}
                        className="rounded-full border border-[var(--border-default)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
                      >
                        带入当前搜索词
                      </button>
                    )}
                    {[
                      "雨夜巷口，林骁穿黑色长风衣，背后霓虹反光。",
                      "古城主殿内，穹顶烛火摇曳，中央悬着王冠圣器。",
                    ].map((sample) => (
                      <button
                        key={sample}
                        onClick={() => setEntityMatchText(sample)}
                        className="rounded-full border border-[var(--border-default)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
                      >
                        使用示例
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleRunEntityMatch}
                  disabled={entityMatchLoading || entityMatchScopeItems.length === 0}
                  className="flex items-center justify-center gap-2 rounded-xl border border-[var(--gold-primary)]/30 bg-[var(--gold-primary)]/10 px-4 py-2 text-[12px] font-medium text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/15 cursor-pointer disabled:opacity-50"
                >
                  {entityMatchLoading ? <Loader size={14} className="animate-spin" /> : <Bot size={14} />}
                  {entityMatchLoading ? "匹配中..." : "开始智能匹配"}
                </button>
                <p className="text-[10px] text-[var(--text-muted)]">
                  快捷键：<span className="text-[var(--text-secondary)]">Ctrl / Cmd + Enter</span>
                </p>
              </div>

              <div className="min-h-0 overflow-y-auto px-5 py-5">
                <div className="flex flex-col gap-4">
                  {entityMatchError && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12px] leading-relaxed text-amber-200">
                      {entityMatchError}
                    </div>
                  )}

                  {!entityMatchError && !entityMatchResults.length && !entityMatchLoading && (
                    <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-10 text-center text-[12px] text-[var(--text-muted)]">
                      输入一段剧情或提示词后点击“开始智能匹配”，结果会按角色、场景、道具分组展示。
                    </div>
                  )}

                  {entityMatchResults.map((section) => (
                    <section key={section.type} className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-semibold text-[var(--text-primary)]">{section.label}</div>
                        <span className="text-[10px] text-[var(--text-muted)]">{section.results.length} 条候选</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {section.results.map((result) => (
                          <div key={`${section.type}-${result.id}`} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-[var(--theme-shadow-soft)]">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-medium text-[var(--text-primary)]">{result.item.name}</span>
                                  <span className="rounded-full border border-[var(--gold-primary)]/20 bg-[var(--gold-primary)]/10 px-2 py-0.5 text-[9px] text-[var(--gold-primary)]">
                                    {Math.round(result.score * 100)}%
                                  </span>
                                  {result.item.source !== "current" && (
                                    <span className="text-[10px] text-[var(--text-muted)]">{result.item.sourceName}</span>
                                  )}
                                </div>
                                {result.item.description && (
                                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)] line-clamp-2">
                                    {result.item.description}
                                  </p>
                                )}
                                {result.item.aliases && result.item.aliases.length > 0 && (
                                  <p className="mt-1 text-[10px] text-[var(--text-muted)] line-clamp-1">
                                    别名：{result.item.aliases.join("、")}
                                  </p>
                                )}
                                <p className="mt-2 text-[10px] text-[var(--text-secondary)]">命中原因：{result.reason}</p>
                              </div>
                              <button
                                onClick={() => handleFocusMatchedItem(section.type, result.item)}
                                className="shrink-0 rounded-lg bg-[var(--gold-primary)] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:brightness-110 cursor-pointer"
                              >
                                定位到条目
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 服装设计弹窗 ── */}
      {costumeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget && !costumeLoading && !costumeApplyingId) closeCostumeModal();
          }}
        >
          <div className="flex w-[920px] max-h-[82vh] flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[#161616] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <div>
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">服装设计</span>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  为 {costumeItem.name} 生成高定级服装方案，并可直接写回角色提示词。
                </p>
              </div>
              <button
                onClick={closeCostumeModal}
                disabled={costumeLoading || !!costumeApplyingId}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
              <div className="flex flex-col gap-4 border-r border-[var(--border-default)] px-5 py-5">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]">角色基础</div>
                  <div className="mt-2 text-[14px] font-medium text-[var(--text-primary)]">{costumeItem.name}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[var(--text-secondary)]">
                      {costumeItem.referenceImage ? "已接入参考图" : "纯文本设计"}
                    </span>
                    {costumeLockComposition && costumeItem.referenceImage && (
                      <span className="rounded-full border border-[var(--gold-primary)]/20 bg-[var(--gold-primary)]/10 px-2 py-0.5 text-[var(--gold-primary)]">
                        构图锁定
                      </span>
                    )}
                  </div>
                  {costumeItem.description && (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)] line-clamp-4">
                      {costumeItem.description}
                    </p>
                  )}
                </div>

                {(costumeDesignContext.worldSetting || costumeDesignContext.stylePrompt) && (
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]">工作台风格上下文</div>
                    {costumeDesignContext.worldSetting && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        世界观 / 风格：{costumeDesignContext.worldSetting}
                      </p>
                    )}
                    {costumeDesignContext.stylePrompt && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        风格补充：{costumeDesignContext.stylePrompt}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-[var(--text-muted)]">服装需求补充</label>
                  <textarea
                    value={costumeNotes}
                    onChange={(e) => setCostumeNotes(e.target.value)}
                    rows={7}
                    placeholder="补充材质、廓形、功能定位、文化背景、剧情用途等..."
                    className="resize-none rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                  />
                </div>

                <label className="flex items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={costumeLockComposition}
                    onChange={(e) => setCostumeLockComposition(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">锁定原图构图</span>
                    <span className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                      尽量保留当前参考图的镜头角度、姿势、光线与背景，只替换服装设计。
                    </span>
                  </div>
                </label>

                <button
                  onClick={regenerateCostumeVariants}
                  disabled={costumeLoading}
                  className="flex items-center justify-center gap-2 rounded-xl border border-[var(--gold-primary)]/30 bg-[var(--gold-primary)]/10 px-4 py-2 text-[12px] font-medium text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/15 cursor-pointer disabled:opacity-50"
                >
                  {costumeLoading ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  重新生成方案
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto px-5 py-5">
                {costumeLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">
                    <Loader size={16} className="animate-spin text-[var(--gold-primary)]" />
                    正在生成服装方案...
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)]">方案列表</div>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        共 {costumeVariants.length} 套方案
                      </span>
                    </div>
                    {costumeVariants.map((variant) => (
                      <div key={variant.id} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-[var(--theme-shadow-soft)]">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-[14px] font-medium text-[var(--text-primary)]">{variant.label}</div>
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{variant.notes}</p>
                          </div>
                          <button
                            onClick={() => navigator.clipboard.writeText(variant.prompt)}
                            className="shrink-0 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
                          >
                            复制提示词
                          </button>
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[var(--border-default)] bg-[var(--surface-contrast)] px-3 py-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">{variant.prompt}</pre>
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={() => applyCostumeVariant(variant, false)}
                            disabled={costumeApplyingId === variant.id}
                            className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer disabled:opacity-50"
                          >
                            {costumeApplyingId === variant.id ? "应用中..." : "写入角色提示词"}
                          </button>
                          <button
                            onClick={() => applyCostumeVariant(variant, true)}
                            disabled={costumeApplyingId === variant.id}
                            className="rounded-lg bg-[var(--gold-primary)] px-3 py-1.5 text-[11px] font-medium text-[#0A0A0A] transition hover:brightness-110 cursor-pointer disabled:opacity-50"
                          >
                            {costumeApplyingId === variant.id ? "生成中..." : "写入并一键生图"}
                          </button>
                        </div>
                      </div>
                    ))}
                    {!costumeVariants.length && (
                      <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-10 text-center text-[12px] text-[var(--text-muted)]">
                        暂无服装方案，点击左侧“重新生成方案”开始生成。
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 批量上传 Sora 进度 ── */}
      {showBatchUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            const finished = batchUploadTasks.every((task) => task.status !== "pending" && task.status !== "uploading");
            if (e.target === e.currentTarget && finished) setShowBatchUploadModal(false);
          }}
        >
          <div className="flex flex-col gap-4 w-[520px] max-h-[70vh] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ExternalLink size={16} className="text-purple-400" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">上传到贞贞工坊-Sora</span>
              </div>
              {batchUploadTasks.every((task) => task.status !== "pending" && task.status !== "uploading") && (
                <button
                  onClick={() => setShowBatchUploadModal(false)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 text-[11px]">
              <span className="text-green-400">✅ 成功 {batchUploadTasks.filter((task) => task.status === "success").length}</span>
              <span className="text-red-400">❌ 失败 {batchUploadTasks.filter((task) => task.status === "error").length}</span>
              <span className="text-[var(--text-muted)]">⏳ 待处理 {batchUploadTasks.filter((task) => task.status === "pending" || task.status === "uploading").length}</span>
            </div>

            <div className="flex flex-col gap-2 overflow-auto max-h-[50vh] pr-1">
              {batchUploadTasks.map((task) => (
                <div
                  key={task.itemId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                    task.status === "success"
                      ? "border-green-500/30 bg-green-500/5"
                      : task.status === "error"
                        ? "border-red-500/30 bg-red-500/5"
                        : task.status === "uploading"
                          ? "border-purple-500/30 bg-purple-500/5"
                          : "border-[var(--border-default)] bg-[#111]"
                  }`}
                >
                  <div className="shrink-0">
                    {task.status === "uploading" && <Loader size={14} className="text-purple-400 animate-spin" />}
                    {task.status === "success" && <Check size={14} className="text-green-400" />}
                    {task.status === "error" && <X size={14} className="text-red-400" />}
                    {task.status === "pending" && <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text-muted)]" />}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">{task.itemName}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 shrink-0">
                        {task.platform}
                      </span>
                    </div>
                    <span className={`text-[10px] truncate ${task.status === "error" ? "text-red-400" : "text-[var(--text-muted)]"}`}>
                      {task.error || task.progress}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {batchUploadTasks.every((task) => task.status !== "pending" && task.status !== "uploading") && (
              <button
                onClick={() => setShowBatchUploadModal(false)}
                className="w-full py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                关闭
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 大图预览 ── */}
      {previewImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 cursor-pointer" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[85vw] max-h-[85vh] flex flex-col items-center">
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="mt-3 text-[13px] text-white/80 font-medium">{previewImage.name}</p>
            <button onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white hover:bg-black/90 transition cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
