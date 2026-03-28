"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "../lib/taskQueue";
import Sidebar from "../components/Sidebar";
import {
  Film, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, CircleCheckBig, Sparkles,
  Play, Pause, Square, Grid2X2, Grid3X3, Timer,
  Download, Volume2, VolumeX, Image as ImageIcon, Loader, RefreshCw,
  Plus, X, Info, Check, GripVertical, Save, Trash2, Scissors, Camera, SkipForward,
  FileText, MessageSquareText, BookOpen,
  Link2, Tag, LayoutGrid,
} from "lucide-react";
import { loadGridImageUrlsFromDisk, saveOneGridImageToDisk, deleteGridImageFromDisk } from "../lib/gridImageStore";
import { GridImportModal, ImageZoomModal, type GridTab } from "../components/GridImportModal";
import JimengLibraryModal from "../components/JimengLibraryModal";
import VideoPlayerModal from "./components/VideoPlayerModal";
import JianyingExportModal from "./components/JianyingExportModal";
import AIPromptGenerateModal from "./components/AIPromptGenerateModal";
import DialoguePickerModal from "./components/DialoguePickerModal";
import WorkflowHandoffChecklist from "../components/WorkflowHandoffChecklist";
import WorkflowRecoveryPanel, { type WorkflowRecoveryPanelItem } from "../components/WorkflowRecoveryPanel";
import { kvLoad, kvSet, kvKeysByPrefix } from "../lib/kvDB";
import { isSoraModel, type SoraCharacter, type SoraCharCategory, SORA_CHAR_CATEGORY_LABEL } from "../lib/zhenzhen/types";
import SoraLibraryModal, { type CharUploadAdapter, type StudioItem } from "./components/SoraLibraryModal";
import { formatPromptLanguage, resolveVideoPromptProfile, type PromptLanguage } from "./lib/promptProfiles";
import { mergeDialogues, type ImportedDialogue } from "./lib/dialogues";
import { buildStudioToVideoChecklist } from "../lib/workflowHandoff";
import { buildOutputEntries, persistProvenanceManifest, summarizeAssetList } from "../lib/provenance/client";
import { BRAND_NAME } from "../lib/brand";
import { buildStyleDatabaseSummary } from "../lib/stylePresets";

/**
 * Resize a data-URL image for vision API — shrink to maxDim and re-encode as JPEG.
 * This dramatically reduces payload size (2-5 MB → 50-150 KB).
 */
async function resizeImageForVision(srcUrl: string, maxDim = 768): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Allow canvas export for cross-origin images
    img.onload = () => {
      const { width, height } = img;
      // Only skip canvas conversion if already a small data URL
      // Non-data URLs (e.g. /api/local-file/...) MUST be converted to base64
      // because external LLM APIs cannot access local server URLs
      if (srcUrl.startsWith("data:") && width <= maxDim && height <= maxDim && srcUrl.length < 200_000) {
        resolve(srcUrl);
        return;
      }
      const scale = Math.min(maxDim / Math.max(width, height), 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        resolve(srcUrl); // Fallback if canvas tainted (CORS)
      }
    };
    img.onerror = () => resolve(srcUrl); // Fallback: return original
    img.src = srcUrl;
  });
}

/**
 * Capture a frame from a video URL at the specified time.
 * Fetches as blob to avoid CORS tainted-canvas issues, then seeks and draws to canvas.
 * @param videoUrl - Video URL (can be CDN or blob URL)
 * @param time - Time in seconds to capture (use -1 for last frame)
 * @param options - Future extensibility: { episode?, beat? }
 */
async function captureFrameFromVideo(
  videoUrl: string,
  time: number,
  _options?: { episode?: string; beat?: number },
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      // Fetch video as blob for same-origin canvas access
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`Failed to fetch video: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        URL.revokeObjectURL(blobUrl);
      };

      // Draw the current video frame to canvas and resolve
      const drawFrame = () => {
        try {
          const w = video.videoWidth || 1280;
          const h = video.videoHeight || 720;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          // Sanity check: a valid JPEG data URL should be > 1KB
          if (dataUrl.length < 1000) {
            throw new Error("截取的帧数据异常（可能帧未解码）");
          }
          cleanup();
          resolve(dataUrl);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      // Wait for the frame to actually be decoded before drawing
      const waitAndDraw = () => {
        // readyState >= 2 means HAVE_CURRENT_DATA (frame data available)
        if (video.readyState >= 2) {
          // Use requestVideoFrameCallback for pixel-accurate capture if available
          if ("requestVideoFrameCallback" in video) {
            (video as unknown as { requestVideoFrameCallback: (cb: () => void) => void })
              .requestVideoFrameCallback(drawFrame);
          } else {
            // Fallback: small delay to let decoder finish
            setTimeout(drawFrame, 150);
          }
        } else {
          // Frame not decoded yet — wait for more data
          let retries = 0;
          const poll = () => {
            retries++;
            if (video.readyState >= 2) {
              setTimeout(drawFrame, 100);
            } else if (retries < 30) {
              setTimeout(poll, 100); // poll up to 3 seconds
            } else {
              // Last resort: try drawing anyway
              drawFrame();
            }
          };
          setTimeout(poll, 100);
        }
      };

      video.onloadedmetadata = () => {
        const seekTime = time < 0 ? Math.max(0, video.duration - 0.05) : Math.min(time, video.duration);
        video.currentTime = seekTime;
      };

      video.onseeked = waitAndDraw;

      video.onerror = () => {
        cleanup();
        reject(new Error("视频加载失败"));
      };

      // Global timeout guard: 30 seconds max
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("截帧超时（30秒）"));
      }, 30000);

      video.src = blobUrl;
      video.load(); // Explicitly trigger loading on some browsers
    } catch (e) {
      if (timeout) clearTimeout(timeout);
      reject(e);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// Video Model — 从设置页同步
// ═══════════════════════════════════════════════════════════

type VideoMode = "single" | "firstlast" | "multiref" | "batchRelay";

interface VideoModelDef {
  id: string;
  name: string;
  model: string;                 // API model identifier, e.g. "veo_3_1-fast"
  url: string;
  apiKey: string;
  provider: "third-party" | "official";  // 第三方中转 or 官方直连
  modes: VideoMode[];           // 支持的模式
}

const VIDEO_MODELS_STORAGE_KEY = "feicai-video-models";

function loadVideoModels(): VideoModelDef[] {
  // Sync fallback for initial render (localStorage may still have data before migration)
  try {
    const raw = localStorage.getItem(VIDEO_MODELS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch { /* ignore */ }
  return [];
}

async function loadVideoModelsAsync(): Promise<VideoModelDef[]> {
  try {
    const raw = await kvLoad(VIDEO_MODELS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch { /* ignore */ }
  return [];
}

const FALLBACK_MODEL: VideoModelDef = {
  id: "__none__", name: "未配置模型", model: "", url: "", apiKey: "", provider: "third-party", modes: ["single", "firstlast", "multiref", "batchRelay"],
};

// ═══════════════════════════════════════════════════════════
// Types & State
// ═══════════════════════════════════════════════════════════

interface VideoCard {
  id: string;
  label: string;
  status: "ready" | "generating" | "pending" | "error";
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  /** 贞贞 API 返回的任务 ID（用于 Sora 角色提取 from_task） */
  apiTaskId?: string;
  /** 生成此视频使用的模型名称 */
  modelName?: string;
}

interface SourceImage {
  key: string;
  label: string;
  url: string;
}

/** Per-EP video state */
interface EpVideoState {
  mode: VideoMode;
  selectedBeat: number;
  selectedGrid: number;
  prompts: { single: string; firstlast: string; multiref: string };
  singleCellPrompts?: Record<string, string>; // "b{beat}-g{grid}" → per-cell motion prompt (auto from 四宫格)
  modelId: string;
  duration: string;
  durationOverride?: string;
  ratio: string;
  ratioOverride?: string;
  resolution: string;
  resolutionOverride?: string;
  motionStrength: number;
  firstFrameUrl: string;
  lastFrameUrl: string;
  refImages: { url: string; label: string }[];
  videoCards: VideoCard[];
  activeCardId: string;
  batchRelayPrompts: { ab: string; bc: string; cd: string };
  batchRelayActiveTab: "ab" | "bc" | "cd";
}

const defaultEpState: EpVideoState = {
  mode: "single",
  selectedBeat: 0,
  selectedGrid: 0,
  prompts: { single: "", firstlast: "", multiref: "" },
  singleCellPrompts: {},
  modelId: "",
  duration: "5",
  durationOverride: "",
  ratio: "16:9",
  ratioOverride: "",
  resolution: "1080p",
  resolutionOverride: "",
  motionStrength: 100,
  firstFrameUrl: "",
  lastFrameUrl: "",
  refImages: [],
  videoCards: [],
  activeCardId: "",
  batchRelayPrompts: { ab: "", bc: "", cd: "" },
  batchRelayActiveTab: "ab",
};

type AllEpStates = Record<string, EpVideoState>;

const STORAGE_KEY = "feicai-video-states";

/**
 * Parse sequence-board-prompt markdown into per-beat, per-cell scene descriptions.
 * Returns string[][] where [beatIdx][cellIdx] = Chinese narrative text.
 */
function parseFourGridScenePrompts(content: string): string[][] {
  const groups: string[][] = [];
  const parts = content.split(/^##[^\n]*(?:格\s*\d+\s*展开|组\s*\d+|格\s*\d+)[^\n]*/m);
  for (let i = 1; i < parts.length && i <= 9; i++) {
    const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
    const scenes: string[] = [];
    const sceneParts = raw.split(/^###\s*\d+[^\n]*/m);
    for (let j = 1; j < sceneParts.length && j <= 4; j++) {
      const s = sceneParts[j].trim();
      if (s) {
        // Extract Chinese narrative (before **[IMG]** marker), strip markdown
        const narrative = s.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/#+\s*/g, "").trim();
        scenes.push(narrative);
      }
    }
    while (scenes.length < 4 && scenes.length > 0) scenes.push("");
    groups.push(scenes);
  }
  return groups;
}

async function fetchOptionalOutputContent(filename: string): Promise<string> {
  try {
    const res = await fetch(`/api/outputs/${encodeURIComponent(filename)}?optional=1`);
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data?.content === "string" ? data.content : "";
  } catch {
    return "";
  }
}

async function loadAllStatesAsync(): Promise<AllEpStates> {
  try {
    const raw = await kvLoad(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

async function saveAllStatesAsync(states: AllEpStates) {
  // Strip large data URLs from refImages/firstFrameUrl/lastFrameUrl before saving
  // Images with "data:" prefix are stored in IndexedDB and only referenced by key
  const stripped: AllEpStates = {};
  for (const [ep, st] of Object.entries(states)) {
    stripped[ep] = {
      ...st,
      firstFrameUrl: st.firstFrameUrl?.startsWith("data:") ? "" : st.firstFrameUrl,
      lastFrameUrl: st.lastFrameUrl?.startsWith("data:") ? "" : st.lastFrameUrl,
      refImages: st.refImages.map((r) => ({
        ...r,
        url: r.url?.startsWith("data:") ? `idb:${r.label}` : r.url,
      })),
      // Strip large data URL thumbnails from video cards
      videoCards: st.videoCards.map((c) => ({
        ...c,
        thumbnailUrl: c.thumbnailUrl?.startsWith("data:") ? "" : c.thumbnailUrl,
      })),
    };
  }
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(stripped));
  } catch {
    // IndexedDB write failed — silently ignore to prevent crash
  }
}

// ═══════════════════════════════════════════════════════════
// Local File Persistence (Plan A for Video)
// Save videos and source frames to outputs/ directory
// ═══════════════════════════════════════════════════════════

/** Persist a video source image (frame/ref) to outputs/video-frames/ (fire-and-forget) */
function persistVideoFrameToLocal(key: string, dataUrl: string) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return;
  fetch("/api/local-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "video-frames", key, data: dataUrl, type: "image" }),
  })
    .then((r) => { if (r.ok) console.log(`[persistFrame] ✓ saved ${key}`); else console.warn(`[persistFrame] ✗ ${key}: ${r.status}`); })
    .catch((e) => console.warn(`[persistFrame] ✗ ${key}:`, e));
}

// ═══════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════

/* ---------- Source Image Thumbnail ---------- */
function SourceThumb({
  url, label, isSelected, hasImage, onClick, onZoom, onDelete, gold = false,
}: {
  url?: string; label: string; isSelected?: boolean; hasImage: boolean;
  onClick: () => void; onZoom?: () => void; onDelete?: () => void; gold?: boolean;
}) {
  return (
    <div onClick={onClick}
      className={`relative flex items-center justify-center h-20 rounded cursor-pointer transition-all ${
        isSelected ? "ring-2 ring-[var(--gold-primary)] bg-[var(--surface-contrast)]" : "bg-[var(--surface-contrast)] border border-[var(--border-default)]"
      }`}>
      {hasImage && url ? (
        <img src={url} alt={label} className="w-full h-full object-contain bg-[var(--bg-card)] rounded" />
      ) : (
        <span className={`text-[12px] ${isSelected || gold ? "text-[var(--gold-primary)]" : "text-[var(--text-muted)]"}`}>{label}</span>
      )}
      {onZoom && hasImage && (
        <button onClick={(e) => { e.stopPropagation(); onZoom(); }}
          className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded bg-[var(--surface-elevated)] hover:bg-[var(--surface-contrast)] cursor-pointer">
          <ZoomIn size={10} className="text-[var(--gold-primary)]" />
        </button>
      )}
      {onDelete && hasImage && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] hover:border-red-400 cursor-pointer">
          <X size={10} className="text-[var(--text-secondary)]" />
        </button>
      )}
    </div>
  );
}

/* ---------- 提示词选择器 Modal ---------- */
type PromptGridTab = "four" | "nine" | "smartNine" | "custom";
function PromptPickerModal({
  open, onClose, onSelect, episode, selectedBeat, episodes,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (prompt: string) => void;
  episode: string;
  selectedBeat: number;
  episodes: string[];
}) {
  const [gridTab, setGridTab] = useState<PromptGridTab>("four");
  const [browseEp, setBrowseEp] = useState(episode);
  const [browseBeat, setBrowseBeat] = useState(selectedBeat);
  const [cells, setCells] = useState<{ prompt: string; imageUrl: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [customCount, setCustomCount] = useState(9);

  // 当弹窗打开时同步默认值 + 自动检测有数据的 Tab
  useEffect(() => {
    if (!open) return;
    setBrowseEp(episode); setBrowseBeat(selectedBeat);
    // 自动检测哪个模式有动态提示词，优先选中有数据的 Tab
    (async () => {
      const tabs: PromptGridTab[] = ["smartNine", "nine", "four", "custom"];
      for (const tab of tabs) {
        const key = tab === "four"
          ? `feicai-motion-prompts-four-${episode}-b${selectedBeat}`
          : tab === "custom"
          ? `feicai-motion-prompts-custom-${episode}`
          : `feicai-motion-prompts-${tab}-${episode}`;
        try {
          const raw = await kvLoad(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const arr = Array.isArray(parsed) ? parsed : parsed?.beats;
            if (arr && arr.some((s: string) => s?.trim())) {
              setGridTab(tab);
              return;
            }
          }
        } catch { /* skip */ }
      }
      setGridTab("four"); // 都没数据时回退
    })();
  }, [open, episode, selectedBeat]);

  // 加载提示词和图片
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // ★ 新项目时不从磁盘加载旧提示词/图片
    const isFresh = localStorage.getItem("feicai-new-project");
    if (isFresh) {
      setCells([]);
      setLoading(false);
      return;
    }
    (async () => {
      const db = await loadGridImageUrlsFromDisk(browseEp);
      // 自定义宫格：从 KV 读取实际格数
      let count = gridTab === "four" ? 4 : 9;
      if (gridTab === "custom") {
        try {
          const cpRaw = await kvLoad(`feicai-custom-grid-prompts-${browseEp}`);
          if (cpRaw) { const d = JSON.parse(cpRaw); if (d.gridCount) { count = d.gridCount; setCustomCount(d.gridCount); } }
        } catch { /* ignore */ }
      }
      const motionKey = gridTab === "four"
        ? `feicai-motion-prompts-four-${browseEp}-b${browseBeat}`
        : gridTab === "custom"
        ? `feicai-motion-prompts-custom-${browseEp}`
        : `feicai-motion-prompts-${gridTab}-${browseEp}`;
      let prompts: string[] = [];
      try {
        const raw = await kvLoad(motionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          // 智能分镜 KV 值是结构化对象 { beats: string[] }，需提取 beats 数组
          if (Array.isArray(parsed)) {
            prompts = parsed;
          } else if (parsed && Array.isArray(parsed.beats)) {
            prompts = parsed.beats;
          }
        }
      } catch { /* 无提示词 */ }
      const result: { prompt: string; imageUrl: string }[] = [];
      for (let i = 0; i < count; i++) {
        const imgKey = gridTab === "four"
          ? `four-${browseEp}-${browseBeat}-${i}`
          : gridTab === "custom"
          ? `custom-${browseEp}-${i}`
          : gridTab === "smartNine"
          ? `smartNine-${browseEp}-${i}`
          : `nine-${browseEp}-${i}`;
        result.push({
          prompt: prompts[i] || "",
          imageUrl: db[imgKey] || "",
        });
      }
      setCells(result);
      setLoading(false);
    })();
  }, [open, gridTab, browseEp, browseBeat]);

  if (!open) return null;

  const epList = episodes.length > 0 ? episodes : ["ep01"];
  const gridCols = gridTab === "four" ? "grid-cols-2"
    : gridTab === "custom" ? (customCount <= 4 ? "grid-cols-2" : "grid-cols-3")
    : "grid-cols-3";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[580px] max-h-[80vh] bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-xl shadow-[var(--theme-shadow-card)] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between h-14 px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">选择动态提示词</span>
          </div>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--surface-contrast-strong)] hover:bg-[var(--bg-hover)] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* 工具栏：EP/组 + 四宫格/九宫格切换 */}
        <div className="flex items-center gap-3 h-11 px-6 bg-[var(--surface-overlay)] shrink-0">
          <select value={browseEp} onChange={(e) => setBrowseEp(e.target.value)} suppressHydrationWarning
            className="h-7 px-2 bg-[var(--bg-card)] border border-[var(--border-default)] rounded text-[11px] font-medium text-[var(--gold-primary)] outline-none cursor-pointer appearance-none">
            {epList.map((ep) => <option key={ep} value={ep} className="bg-[var(--bg-card)]">{ep.toUpperCase()}</option>)}
          </select>
          {gridTab === "four" && (
            <select value={browseBeat} onChange={(e) => setBrowseBeat(Number(e.target.value))} suppressHydrationWarning
              className="h-7 px-2 bg-[var(--bg-card)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none">
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i} value={i} className="bg-[var(--bg-card)]">组{i + 1}</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <div className="flex items-center h-7 rounded border border-[var(--border-default)] overflow-hidden">
            <button onClick={() => setGridTab("four")}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "four" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
              <Grid2X2 size={12} />四宫格
            </button>
            <button onClick={() => setGridTab("nine")}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "nine" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
              <Grid3X3 size={12} />九宫格
            </button>
            <button onClick={() => setGridTab("smartNine")}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "smartNine" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
              <Sparkles size={12} />智能分镜
            </button>
            <button onClick={() => setGridTab("custom")}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "custom" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
              <LayoutGrid size={12} />自定义
            </button>
          </div>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* 宫格内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">加载中...</div>
          ) : (
            <div className={`grid ${gridCols} gap-3`}>
              {cells.map((cell, idx) => {
                const hasPrompt = !!cell.prompt.trim();
                return (
                  <button
                    key={idx}
                    disabled={!hasPrompt}
                    onClick={() => { if (hasPrompt) { onSelect(cell.prompt); onClose(); } }}
                    className={`group relative flex flex-col rounded-lg border overflow-hidden text-left transition-all ${
                      hasPrompt
                        ? "border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:shadow-[0_0_12px_rgba(201,169,98,0.15)] cursor-pointer"
                        : "border-[#2A2A2A] opacity-40 cursor-not-allowed"
                    }`}
                  >
                    {/* 缩略图 */}
                    <div className={`w-full aspect-square bg-[var(--bg-card)] flex items-center justify-center ${hasPrompt ? "group-hover:brightness-110" : ""}`}>
                      {cell.imageUrl ? (
                        <img src={cell.imageUrl} alt={`格${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)]">无图片</span>
                      )}
                    </div>
                    {/* 格子编号标签 */}
                    <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      hasPrompt ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "bg-[var(--surface-overlay)] text-[var(--text-muted)]"
                    }`}>格{idx + 1}</div>
                    {/* 提示词预览 */}
                    <div className="px-2.5 py-2 bg-[var(--surface-contrast)] min-h-[52px]">
                      <p className={`text-[10px] leading-relaxed line-clamp-3 ${hasPrompt ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>
                        {hasPrompt ? cell.prompt : "无提示词"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="h-px bg-[var(--border-default)]" />
        <div className="flex items-center gap-2 h-9 px-6 bg-[var(--surface-contrast-strong)] shrink-0">
          <Info size={10} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">点击任意格子即可填入对应提示词，灰色格子表示无提示词</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Video Frame Capture Modal ---------- */
function VideoFrameCaptureModal({
  open, onClose, videoCards, onCapture,
}: {
  open: boolean;
  onClose: () => void;
  videoCards: VideoCard[];
  onCapture: (frameDataUrl: string, label: string) => void;
}) {
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [seekTime, setSeekTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [capturing, setCapturing] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const readyCards = videoCards.filter((c) => c.status === "ready" && c.videoUrl);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setSelectedCardId("");
      setSeekTime(0);
      setDuration(0);
      setPreviewUrl("");
    }
  }, [open]);

  const selectedCard = readyCards.find((c) => c.id === selectedCardId);

  const handleSelectCard = (card: VideoCard) => {
    setSelectedCardId(card.id);
    setPreviewUrl(card.videoUrl || "");
    setSeekTime(0);
    setDuration(0);
  };

  const handleSeek = (time: number) => {
    setSeekTime(time);
    if (previewVideoRef.current) {
      previewVideoRef.current.currentTime = time;
    }
  };

  const handleCaptureFrame = async (atEnd: boolean) => {
    if (!selectedCard?.videoUrl) return;
    setCapturing(true);
    try {
      const time = atEnd ? -1 : seekTime;
      const frame = await captureFrameFromVideo(selectedCard.videoUrl, time, {});
      onCapture(frame, `${selectedCard.label}${atEnd ? "尾帧" : `@${seekTime.toFixed(1)}s`}`);
      onClose();
    } catch (e) {
      console.error("[Frame Capture]", e);
    } finally {
      setCapturing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#00000080]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-h-[85vh] bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-lg overflow-hidden flex flex-col shadow-[var(--theme-shadow-card)]">
        {/* Header */}
        <div className="flex items-center justify-between h-12 px-5 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={14} className="text-[var(--gold-primary)]" />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">从视频截取帧</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] cursor-pointer">
            <X size={14} className="text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {readyCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Timer size={24} className="text-[var(--text-muted)]" />
              <span className="text-[12px] text-[var(--text-muted)]">暂无已完成的视频，请先生成视频</span>
            </div>
          ) : (
            <>
              {/* Video card list */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] text-[var(--text-tertiary)]">选择视频</span>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {readyCards.map((card) => (
                    <button key={card.id} onClick={() => handleSelectCard(card)}
                      className={`flex flex-col gap-1 w-[100px] shrink-0 rounded p-1.5 border transition cursor-pointer ${
                        selectedCardId === card.id
                          ? "border-[var(--gold-primary)] bg-[#C9A96215]"
                          : "border-[var(--border-default)] hover:border-[var(--text-secondary)]"
                      }`}>
                      <div className="h-[50px] bg-[var(--surface-contrast)] rounded overflow-hidden flex items-center justify-center">
                        {card.thumbnailUrl ? (
                          <img src={card.thumbnailUrl} alt={card.label} className="w-full h-full object-contain" />
                        ) : (
                          <ImageIcon size={14} className="text-[var(--border-default)]" />
                        )}
                      </div>
                      <span className={`text-[10px] text-center ${selectedCardId === card.id ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>{card.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview & seek */}
              {selectedCard?.videoUrl && (
                <div className="flex flex-col gap-3">
                  <div className="relative bg-[var(--bg-card)] rounded overflow-hidden aspect-video">
                    <video ref={previewVideoRef} src={previewUrl} className="w-full h-full object-contain"
                      onLoadedMetadata={() => {
                        const v = previewVideoRef.current;
                        if (v) { setDuration(v.duration); v.currentTime = 0; }
                      }}
                      muted preload="auto" />
                  </div>

                  {/* Seek slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[var(--text-tertiary)]">拖动选择截帧时间点</span>
                      <span className="text-[10px] font-mono text-[var(--gold-primary)]">{seekTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
                    </div>
                    <input type="range" min={0} max={duration || 1} step={0.05} value={seekTime}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="w-full h-1.5 accent-[var(--gold-primary)] cursor-pointer" />
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleCaptureFrame(false)} disabled={capturing}
                      className="flex-1 flex items-center justify-center gap-2 h-9 rounded border border-[var(--gold-transparent)] hover:bg-[#C9A96210] transition cursor-pointer disabled:opacity-40">
                      <Camera size={13} className="text-[var(--gold-primary)]" />
                      <span className="text-[11px] text-[var(--gold-primary)]">{capturing ? "截取中..." : "截取当前帧"}</span>
                    </button>
                    <button onClick={() => handleCaptureFrame(true)} disabled={capturing}
                      className="flex-1 flex items-center justify-center gap-2 h-9 rounded bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-60">
                      <SkipForward size={13} className="text-[#0A0A0A]" />
                      <span className="text-[11px] font-medium text-[#0A0A0A]">{capturing ? "截取中..." : "截取最后一帧"}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Video Timeline Card ---------- */
function TimelineCard({ card, isActive, onClick, onDelete, showDelete }: { card: VideoCard; isActive: boolean; onClick: () => void; onDelete?: () => void; showDelete?: boolean }) {
  const statusColor = card.status === "ready" ? "text-[var(--gold-primary)]"
    : card.status === "generating" ? "text-[var(--gold-primary)]"
    : card.status === "error" ? "text-red-400" : "text-[var(--text-muted)]";
  const statusText = card.status === "ready" ? "就绪"
    : card.status === "generating" ? `生成中 ${card.progress || 0}%`
    : card.status === "error" ? "失败" : "未生成";
  return (
    <div onClick={onClick} className={`relative flex flex-col gap-2 w-[240px] shrink-0 cursor-pointer transition ${isActive ? "ring-1 ring-[var(--gold-primary)] rounded" : ""}`}>
      {showDelete && onDelete && card.status !== "generating" && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center transition cursor-pointer animate-[fadeIn_0.15s_ease-in]"
          title="删除此卡片">
          <X size={12} className="text-white" />
        </button>
      )}
      <div className={`flex items-center justify-center h-[136px] rounded bg-[var(--surface-contrast)] border ${isActive ? "border-[var(--gold-primary)]" : "border-[var(--border-default)]"}`}>
        {card.status === "ready" && card.thumbnailUrl ? (
          <div className="relative w-full h-full">
            <img src={card.thumbnailUrl} alt={card.label} className="w-full h-full object-contain bg-[var(--bg-card)] rounded" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#C9A96260] flex items-center justify-center"><Play size={16} className="text-[var(--gold-primary)] ml-0.5" /></div>
            </div>
          </div>
        ) : card.status === "generating" ? (
          <Loader size={24} className="animate-spin text-[#C9A96250]" />
        ) : card.status === "error" ? (
          <div className="flex flex-col items-center gap-1">
            <X size={20} className="text-red-400" />
            <span className="text-[10px] text-red-400/60">生成失败</span>
          </div>
        ) : (
          <ImageIcon size={24} className="text-[var(--border-default)]" />
        )}
      </div>
      <div className="flex items-center justify-between px-1.5">
        <span className={`text-[12px] ${isActive ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>{card.label}</span>
        <span className={`text-[11px] ${statusColor}`}>{statusText}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Module-level State Cache — 跨导航保持状态
// ═══════════════════════════════════════════════════════════

const videoCache = {
  _populated: false,
  allStates: {} as AllEpStates,
  episode: "ep01",
  episodes: [] as string[],
  sourceImages: [] as SourceImage[],
  loaded: false,
  videoModels: [] as VideoModelDef[],
};

// ── 跨导航生成任务存活机制 ──
// 追踪正在进行中的视频生成任务（cardId），导航切换后不会丢失
const pendingGenerations = new Set<string>();

// ★ 后台完成/失败记录（组件 unmount 期间的结果，re-mount 时弹 toast 通知用户）
const backgroundResults: { ep: string; label: string; ok: boolean; detail?: string }[] = [];

// ★ 模拟进度定时器（服务端长轮询期间无进度反馈，前端递增动画避免用户以为卡死）
const progressTimers = new Map<string, ReturnType<typeof setInterval>>();

function startProgressTimer(ep: string, cardId: string) {
  if (progressTimers.has(cardId)) return;
  const timer = setInterval(() => {
    const card = videoCache.allStates[ep]?.videoCards?.find((c: VideoCard) => c.id === cardId);
    if (!card || card.status !== "generating") {
      clearInterval(timer);
      progressTimers.delete(cardId);
      return;
    }
    // 模拟递增：每 3 秒 +2~5%，最高 90%（真实结果会直接跳到 100% 或 0%）
    const next = Math.min((card.progress || 0) + 2 + Math.random() * 3, 90);
    moduleUpdateCard(ep, cardId, { progress: Math.round(next) });
  }, 3000);
  progressTimers.set(cardId, timer);
}

function stopProgressTimer(cardId: string) {
  const t = progressTimers.get(cardId);
  if (t) { clearInterval(t); progressTimers.delete(cardId); }
}

// ★ beforeunload 防护 — 有任务进行中时阻止意外刷新/关闭（仅弹浏览器原生确认框）
function _beforeUnloadGuard(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
function syncBeforeUnload() {
  if (typeof window === "undefined") return;
  if (pendingGenerations.size > 0) {
    window.removeEventListener("beforeunload", _beforeUnloadGuard);
    window.addEventListener("beforeunload", _beforeUnloadGuard);
  } else {
    window.removeEventListener("beforeunload", _beforeUnloadGuard);
  }
}

// 模块级 React state setter 引用（组件 mount 时注册，unmount 时清空）
let moduleSetAllStates: ((fn: (prev: AllEpStates) => AllEpStates) => void) | null = null;

/** 模块级卡片更新 —— 同时更新 videoCache + React state（若组件已挂载） */
function moduleUpdateCard(episodeKey: string, cardId: string, patch: Partial<VideoCard>) {
  // 1. 更新模块缓存（始终可用）
  const cached = videoCache.allStates[episodeKey];
  if (cached) {
    videoCache.allStates = {
      ...videoCache.allStates,
      [episodeKey]: {
        ...cached,
        videoCards: cached.videoCards.map(c => c.id === cardId ? { ...c, ...patch } : c),
      },
    };
  }
  // 2. 更新 React state（仅当组件已挂载）
  if (moduleSetAllStates) {
    moduleSetAllStates(prev => {
      const cur = prev[episodeKey];
      if (!cur) return prev;
      return { ...prev, [episodeKey]: { ...cur, videoCards: cur.videoCards.map(c => c.id === cardId ? { ...c, ...patch } : c) } };
    });
  }
  // 3. 异步持久化到 kvDB（确保切换页面后数据也保存）
  saveAllStatesAsync(videoCache.allStates).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════

export default function VideoPage() {
  const { toast } = useToast();
  const { addTask, removeTask } = useTaskQueue();
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Global State（从缓存恢复）──
  const [allStates, setAllStates] = useState<AllEpStates>(videoCache.allStates);
  const [episode, setEpisode] = useState(videoCache.episode);
  const [episodes, setEpisodes] = useState<string[]>(videoCache.episodes);
  const [loaded, setLoaded] = useState(videoCache.loaded);
  const [sourceImages, setSourceImages] = useState<SourceImage[]>(videoCache.sourceImages);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTarget, setImportTarget] = useState<"single" | "first" | "last" | "multiref">("single");
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [showFrameCapture, setShowFrameCapture] = useState(false);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [aiPromptModalOpen, setAiPromptModalOpen] = useState(false);
  const [aiPromptGenerating, setAiPromptGenerating] = useState(false);
  const [dialoguePickerOpen, setDialoguePickerOpen] = useState(false);
  const [dialoguesByBeat, setDialoguesByBeat] = useState<Record<string, ImportedDialogue[]>>({});
  const [editingDialogueIndex, setEditingDialogueIndex] = useState(-1);
  const [editingDialogueRole, setEditingDialogueRole] = useState("");
  const [editingDialogueText, setEditingDialogueText] = useState("");
  const [showJimengLibrary, setShowJimengLibrary] = useState(false);
  // 即梦图库选择目标：multiref / relay-{slotIdx}
  const jimengLibraryTargetRef = useRef<string>("multiref");
  const [timelineDeleteMode, setTimelineDeleteMode] = useState(false);
  const [isMergingVideos, setIsMergingVideos] = useState(false);
  // 视频缩略图网格布局模式
  const [videoLayout, setVideoLayout] = useState<"single" | "grid">("grid");
  // 弹窗播放器
  const [playerModalCard, setPlayerModalCard] = useState<VideoCard | null>(null);
  // 剪映草稿导出
  const [jianyingModalOpen, setJianyingModalOpen] = useState(false);
  const [jianyingExporting, setJianyingExporting] = useState(false);
  const [jianyingResult, setJianyingResult] = useState<{ draftPath: string; videoCount: number; totalDurationSec: number; draftName: string } | null>(null);
  const [frameCaptureTarget, setFrameCaptureTarget] = useState<"first" | "last">("first");
  // 批量接力：单格上传用的 ref 和目标索引
  const relayUploadRef = useRef<HTMLInputElement>(null);
  const relayUploadSlotRef = useRef<number>(0);
  // Derived: how many cards are currently generating
  const generatingCount = (allStates[episode] || defaultEpState).videoCards.filter((c) => c.status === "generating").length;
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Reset progress bar when active card changes
  const currentActiveCardId = (allStates[episode] || defaultEpState).activeCardId;
  useEffect(() => {
    setCurrentTime(0);
    setVideoDuration(0);
    setIsPlaying(false);
  }, [currentActiveCardId]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [videoModels, setVideoModels] = useState<VideoModelDef[]>(videoCache.videoModels);

  // ── Current EP state (derived) ──
  const epState = allStates[episode] || { ...defaultEpState };
  // 批量接力：是否4张图全部就绪
  const batchRelayAllReady = epState.mode === "batchRelay" && sourceImages.filter((s) => s.url).length >= 4;
  const setEpState = useCallback((partial: Partial<EpVideoState>) => {
    setAllStates((prev) => ({
      ...prev,
      [episode]: { ...(prev[episode] || { ...defaultEpState }), ...partial },
    }));
  }, [episode]);

  // Selected model
  const selectedModel = videoModels.find((m) => m.id === epState.modelId) || videoModels[0] || FALLBACK_MODEL;
  const availableModels = videoModels.filter((m) => m.modes.includes(epState.mode));
  const currentBeatDialogueKey = `b${epState.selectedBeat}`;
  const currentBeatDialogues = dialoguesByBeat[currentBeatDialogueKey] || [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await kvLoad(`feicai-dialogues-${episode}`);
        if (cancelled) return;
        if (!raw) {
          setDialoguesByBeat({});
          return;
        }
        const parsed = JSON.parse(raw);
        setDialoguesByBeat(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        if (!cancelled) setDialoguesByBeat({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episode]);

  useEffect(() => {
    setEditingDialogueIndex(-1);
    setEditingDialogueRole("");
    setEditingDialogueText("");
  }, [episode, epState.selectedBeat]);

  const persistDialogues = useCallback((updater: (prev: Record<string, ImportedDialogue[]>) => Record<string, ImportedDialogue[]>) => {
    setDialoguesByBeat((prev) => {
      const next = updater(prev);
      void kvSet(`feicai-dialogues-${episode}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [episode]);

  const handleImportDialogues = useCallback((dialogues: ImportedDialogue[]) => {
    if (dialogues.length === 0) {
      toast("当前分镜没有可导入的台词", "info");
      return;
    }
    persistDialogues((prev) => {
      const existing = prev[currentBeatDialogueKey] || [];
      return {
        ...prev,
        [currentBeatDialogueKey]: mergeDialogues(existing, dialogues),
      };
    });
    toast(`已导入 ${dialogues.length} 条台词`, "success");
  }, [currentBeatDialogueKey, persistDialogues, toast]);

  const handleClearDialogues = useCallback(() => {
    persistDialogues((prev) => {
      const next = { ...prev };
      delete next[currentBeatDialogueKey];
      return next;
    });
    setEditingDialogueIndex(-1);
    setEditingDialogueRole("");
    setEditingDialogueText("");
    toast("已清除当前组导入台词", "success");
  }, [currentBeatDialogueKey, persistDialogues, toast]);

  const startEditingDialogue = useCallback((index: number, dialogue: ImportedDialogue) => {
    setEditingDialogueIndex(index);
    setEditingDialogueRole(dialogue.role);
    setEditingDialogueText(dialogue.text);
  }, []);

  const saveEditedDialogue = useCallback(() => {
    const role = editingDialogueRole.trim() || "角色";
    const text = editingDialogueText.trim();
    if (!text) {
      toast("台词内容不能为空", "error");
      return;
    }
    persistDialogues((prev) => {
      const current = [...(prev[currentBeatDialogueKey] || [])];
      if (!current[editingDialogueIndex]) return prev;
      current[editingDialogueIndex] = { ...current[editingDialogueIndex], role, text };
      return { ...prev, [currentBeatDialogueKey]: current };
    });
    setEditingDialogueIndex(-1);
    setEditingDialogueRole("");
    setEditingDialogueText("");
  }, [currentBeatDialogueKey, editingDialogueIndex, editingDialogueRole, editingDialogueText, persistDialogues, toast]);

  const removeDialogue = useCallback((index: number) => {
    persistDialogues((prev) => {
      const current = (prev[currentBeatDialogueKey] || []).filter((_, itemIndex) => itemIndex !== index);
      if (current.length === 0) {
        const next = { ...prev };
        delete next[currentBeatDialogueKey];
        return next;
      }
      return { ...prev, [currentBeatDialogueKey]: current };
    });
    if (editingDialogueIndex === index) {
      setEditingDialogueIndex(-1);
      setEditingDialogueRole("");
      setEditingDialogueText("");
    }
  }, [currentBeatDialogueKey, editingDialogueIndex, persistDialogues]);
  // ═══════════════════════════════════════════════════════════
  // Sora 角色（从已生成视频中提取，@username 引用）
  // ═══════════════════════════════════════════════════════════
  // ★ Sora 角色库（从视频中提取的角色，可在后续视频中引用）
  const [soraCharacters, setSoraCharacters] = useState<SoraCharacter[]>([]);
  // 已选中的 Sora 角色 ID（生成时在提示词注入 @username）
  const [selectedSoraCharIds, setSelectedSoraCharIds] = useState<string[]>([]);
  // 素材库弹窗开关
  const [soraLibModalOpen, setSoraLibModalOpen] = useState(false);
  // 正在提取角色的视频卡片 ID（显示 loading 状态）
  const [extractingCharCardId, setExtractingCharCardId] = useState<string | null>(null);
  // 视频播放器中提取素材时选择的分类
  const [extractCategory, setExtractCategory] = useState<SoraCharCategory>("character");
  // 当前模型是否为 Sora（决定是否显示角色上传区域）
  const isCurrentModelSora = isSoraModel(selectedModel.model || selectedModel.name);

  // ★ 加载已提取的 Sora 角色库
  useEffect(() => {
    try {
      const cached = localStorage.getItem("feicai-sora-characters");
      if (cached) setSoraCharacters(JSON.parse(cached));
    } catch { /* ignore */ }
  }, []);

  // 切换 Sora 角色选中状态
  const toggleSoraChar = (charId: string) => {
    setSelectedSoraCharIds(prev =>
      prev.includes(charId) ? prev.filter(id => id !== charId) : [...prev, charId]
    );
  };

  /**
   * ★ 从已生成的视频中提取 Sora 角色
   * 调用 POST /api/zhenzhen/character { fromTask, timestamps }
   * 返回后存入 soraCharacters 并持久化
   */
  async function extractSoraCharacter(card: VideoCard, timestamps = "1,3", category: SoraCharCategory = "character"): Promise<SoraCharacter | null> {
    const apiUrl = selectedModel.url?.replace(/\/+$/, "") || "";
    const fromTask = card.apiTaskId || "";
    const videoUrl = card.videoUrl || "";

    if (!fromTask && !videoUrl) {
      toast("此视频无任务ID和URL，无法提取角色", "error");
      return null;
    }

    setExtractingCharCardId(card.id);
    try {
      const res = await fetch("/api/zhenzhen/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: selectedModel.apiKey,
          baseUrl: apiUrl,
          timestamps,
          ...(fromTask ? { fromTask } : { url: videoUrl }),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast(`角色提取失败: ${err.error || res.statusText}`, "error");
        return null;
      }

      const data = await res.json();
      if (!data.id || !data.username) {
        toast("角色提取失败: 未返回有效的角色信息", "error");
        return null;
      }

      const newChar: SoraCharacter = {
        id: data.id,
        username: data.username,
        profilePicture: data.profile_picture_url || "",
        permalink: data.permalink || "",
        createdAt: Date.now(),
        fromVideoUrl: videoUrl,
        fromTaskId: fromTask,
        category,
      };

      // 保存到状态 + localStorage
      setSoraCharacters(prev => {
        const updated = [...prev.filter(c => c.id !== newChar.id), newChar];
        localStorage.setItem("feicai-sora-characters", JSON.stringify(updated));
        return updated;
      });

      toast(`角色 @${data.username} 已创建！后续视频中可选择此角色`, "success");
      return newChar;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络错误";
      toast(`角色提取异常: ${msg}`, "error");
      return null;
    } finally {
      setExtractingCharCardId(null);
    }
  }

  /** 删除已提取的 Sora 角色 */
  function deleteSoraCharacter(charId: string) {
    setSoraCharacters(prev => {
      const updated = prev.filter(c => c.id !== charId);
      localStorage.setItem("feicai-sora-characters", JSON.stringify(updated));
      return updated;
    });
    setSelectedSoraCharIds(prev => prev.filter(id => id !== charId));
    toast("角色已删除", "info");
  }

  async function uploadStudioItemToSora(
    route: "/api/zhenzhen/img2char" | "/api/geeknow/img2char",
    item: StudioItem,
    apiKey: string,
    baseUrl: string,
  ) {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        baseUrl: baseUrl || undefined,
        imageData: item.referenceImage,
        category: item.category,
        nickname: item.name,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `img2char 失败 (${res.status})`);
    }
    const data = await res.json();
    return {
      id: data.id || `char-${Date.now()}`,
      username: data.username || item.name,
      profilePicture: data.profile_picture_url || "",
      permalink: data.permalink || "",
      createdAt: Date.now(),
      category: item.category,
      nickname: item.name,
      fromVideoUrl: data.videoUrl || "",
      fromTaskId: data.taskId || "",
    } satisfies SoraCharacter;
  }

  // ★ 多平台上传适配器 — 工作台素材 → img2char 流水线
  const soraUploadAdapters: CharUploadAdapter[] = [
    {
      name: "贞贞工坊",
      async upload(item: StudioItem, apiKey: string, baseUrl: string) {
        return uploadStudioItemToSora("/api/zhenzhen/img2char", item, apiKey, baseUrl);
      },
    },
    {
      name: "GeekNow",
      async upload(item: StudioItem, apiKey: string, baseUrl: string) {
        return uploadStudioItemToSora("/api/geeknow/img2char", item, apiKey, baseUrl);
      },
    },
  ];
  // Current mode prompt (per-mode independent; single mode is per-cell, batchRelay is per-pair)
  const singleCellKey = `b${epState.selectedBeat}-g${epState.selectedGrid}`;
  const batchRelayPrompts = epState.batchRelayPrompts || { ab: "", bc: "", cd: "" };
  const batchRelayActiveTab = epState.batchRelayActiveTab || "ab";
  const effectiveDuration = epState.durationOverride?.trim() || epState.duration;
  const effectiveRatio = epState.ratioOverride?.trim() || epState.ratio;
  const effectiveResolution = epState.resolutionOverride?.trim() || epState.resolution;
  const currentPrompt = epState.mode === "single"
    ? (epState.singleCellPrompts?.[singleCellKey] ?? "")
    : epState.mode === "batchRelay"
      ? (batchRelayPrompts[batchRelayActiveTab] ?? "")
      : (epState.prompts?.[epState.mode] ?? "");
  const soraSmartMatchText = useMemo(() => {
    const dialogueLines = currentBeatDialogues.map((dialogue) => `${dialogue.role}：${dialogue.text}`);
    return [
      currentPrompt.trim(),
      ...dialogueLines,
    ]
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }, [currentBeatDialogues, currentPrompt]);
  const soraSmartMatchLabel = useMemo(() => {
    const parts = [
      episode.toUpperCase(),
      `组${epState.selectedBeat + 1}`,
    ];
    if (epState.mode === "single") {
      parts.push(`格${epState.selectedGrid + 1}`);
    }
    return parts.join(" · ");
  }, [episode, epState.mode, epState.selectedBeat, epState.selectedGrid]);
  const videoHandoffChecklist = useMemo(
    () =>
      buildStudioToVideoChecklist({
        episode,
        episodes,
        mode: epState.mode,
        selectedGridLabel: sourceImages[epState.selectedGrid]?.label || `格${epState.selectedGrid + 1}`,
        selectedSourceReady: Boolean(sourceImages[epState.selectedGrid]?.url),
        sourceImageCount: sourceImages.filter((item) => Boolean(item.url)).length,
        firstFrameReady: Boolean(epState.firstFrameUrl),
        lastFrameReady: Boolean(epState.lastFrameUrl),
        refImageCount: epState.refImages.filter((item) => Boolean(item.url)).length,
        currentPromptLength: currentPrompt.trim().length,
        selectedModelName: selectedModel.name || selectedModel.model || "未配置模型",
        selectedModelReady: Boolean(
          selectedModel.apiKey &&
          selectedModel.url &&
          (
            (selectedModel.model || selectedModel.name || "").trim() ||
            ["t8star.cn", "geeknow.top", "closeai.icu", "qnaigc.com", "yunwu.ai"].some((domain) => (selectedModel.url || "").includes(domain))
          )
        ),
        selectedModelSupportsMode: selectedModel.modes.includes(epState.mode),
        readyVideoCount: epState.videoCards.filter((card) => card.status === "ready" && card.videoUrl).length,
      }),
    [episode, episodes, epState.mode, epState.selectedGrid, epState.firstFrameUrl, epState.lastFrameUrl, epState.refImages, epState.videoCards, currentPrompt, selectedModel, sourceImages],
  );
  async function persistVideoProvenance(options: {
    title: string;
    stage: string;
    prompt: string;
    videoOutputs?: Array<{ key: string; url?: string; path?: string; label?: string }>;
    frameOutputs?: Array<{ key: string; url?: string; path?: string; label?: string }>;
    inputImages?: Array<{ label?: string; url: string; key?: string }>;
    referenceImages?: Array<{ label?: string; url: string; key?: string }>;
    endImage?: { label?: string; url: string; key?: string } | null;
    context?: Record<string, unknown>;
  }) {
    try {
      await persistProvenanceManifest({
        kind: "video",
        title: options.title,
        stage: options.stage,
        episode,
        prompt: options.prompt,
        model: {
          provider: selectedModel.provider || "third-party",
          name: selectedModel.name || "",
          model: selectedModel.model || "",
          baseUrl: selectedModel.url || "",
          duration: effectiveDuration,
          ratio: effectiveRatio,
          resolution: effectiveResolution,
          motionStrength: epState.motionStrength,
        },
        inputs: {
          sourceImages: summarizeAssetList(options.inputImages || []),
          referenceImages: summarizeAssetList(options.referenceImages || []),
          endImage: options.endImage ? summarizeAssetList([options.endImage]) : [],
          soraMentions: selectedSoraCharIds
            .map((id) => soraCharacters.find((char) => char.id === id))
            .filter(Boolean)
            .map((char) => `@${char!.username}`),
        },
        outputs: [
          ...buildOutputEntries("videos", options.videoOutputs || []),
          ...buildOutputEntries("video-frames", options.frameOutputs || []),
        ],
        context: {
          mode: epState.mode,
          selectedBeat: epState.selectedBeat,
          selectedGrid: epState.selectedGrid,
          ...options.context,
        },
      });
    } catch (error) {
      console.warn("[video-provenance] failed:", error);
    }
  }
  const setCurrentPrompt = useCallback((text: string) => {
    if (epState.mode === "single") {
      const key = `b${epState.selectedBeat}-g${epState.selectedGrid}`;
      setEpState({ singleCellPrompts: { ...(epState.singleCellPrompts || {}), [key]: text } });
    } else if (epState.mode === "batchRelay") {
      const tab = epState.batchRelayActiveTab || "ab";
      setEpState({ batchRelayPrompts: { ...(epState.batchRelayPrompts || { ab: "", bc: "", cd: "" }), [tab]: text } });
    } else {
      setEpState({ prompts: { ...epState.prompts, [epState.mode]: text } });
    }
  }, [epState.prompts, epState.mode, epState.selectedBeat, epState.selectedGrid, epState.singleCellPrompts, epState.batchRelayPrompts, epState.batchRelayActiveTab, setEpState]);

  // ── Detect episodes from KV + grid-images（项目隔离，不再扫描 outputs/ .md 文件）──
  useEffect(() => {
    const detectEpisodes = async () => {
      // ★ 新项目标记存在时，跳过所有 EP 检测（含磁盘图片），返回干净状态
      const isFresh = localStorage.getItem("feicai-new-project");
      if (isFresh) {
        setEpisodes(["ep01"]);
        setEpisode("ep01");
        return;
      }
      try {
        const epSet = new Set<string>();
        // 来源1：KV 智能分镜提示词
        try {
          const smartKeys = await kvKeysByPrefix("feicai-smart-nine-prompts-");
          for (const k of smartKeys) { const m = k.match(/(ep\d+)$/); if (m) epSet.add(m[1]); }
        } catch {}
        // 来源2：KV 运镜提示词
        try {
          const motionKeys = await kvKeysByPrefix("feicai-motion-prompts-");
          for (const k of motionKeys) { const m = k.match(/(ep\d+)/); if (m) epSet.add(m[1]); }
        } catch {}
        // 来源3：grid-images 磁盘图片
        try {
          const res = await fetch("/api/grid-image?list=1");
          if (res.ok) {
            const data = await res.json();
            const keys: string[] = data.keys || [];
            for (const k of keys) { const m = k.match(/(ep\d+)/); if (m) epSet.add(m[1]); }
          }
        } catch {}
        // 来源4：KV 节拍拆解提示词
        try {
          const beatKeys = await kvKeysByPrefix("feicai-beat-prompts-");
          for (const k of beatKeys) { const m = k.match(/(ep\d+)$/); if (m) epSet.add(m[1]); }
        } catch {}
        const sorted = Array.from(epSet).sort();
        if (sorted.length > 0) {
          setEpisodes(sorted);
        } else {
          setEpisodes(["ep01"]);
        }
      } catch {
        setEpisodes(["ep01"]);
      }
    };
    detectEpisodes();
  }, []);

  // ── Load persisted states ──
  useEffect(() => {
    // ★ 缓存已有 → 跳过 IDB 恢复
    if (videoCache._populated) return;

    (async () => {
      // Load video models from IndexedDB (with localStorage migration)
      const models = await loadVideoModelsAsync();
      if (models.length > 0) setVideoModels(models);
      else setVideoModels(loadVideoModels()); // sync fallback

      const saved = await loadAllStatesAsync();
      if (Object.keys(saved).length > 0) {
        // Migrate old prompt → prompts & ensure batchRelay fields
        const migrated: AllEpStates = {};
        for (const [ep, st] of Object.entries(saved)) {
          const s = st as EpVideoState & { prompt?: string };
          if (s.prompt !== undefined && !s.prompts) {
            migrated[ep] = { ...defaultEpState, ...s, prompts: { single: s.prompt, firstlast: s.prompt, multiref: s.prompt } };
            delete (migrated[ep] as unknown as Record<string, unknown>).prompt;
          } else {
            migrated[ep] = { ...defaultEpState, ...s, prompts: s.prompts || { single: "", firstlast: "", multiref: "" } };
          }
          // Ensure batchRelay fields exist for old data
          if (!migrated[ep].batchRelayPrompts) {
            migrated[ep].batchRelayPrompts = { ab: "", bc: "", cd: "" };
          }
          if (!migrated[ep].batchRelayActiveTab) {
            migrated[ep].batchRelayActiveTab = "ab";
          }
        }
        setAllStates(migrated);
        const lastEp = localStorage.getItem("feicai-video-active-ep");
        if (lastEp && migrated[lastEp]) setEpisode(lastEp);
      }

      const isFresh = localStorage.getItem("feicai-new-project");
      if (isFresh) {
        // ★ 新项目：彻底重置视频页状态（含模块级缓存）
        setAllStates({});
        setEpisode("ep01");
        setSourceImages([]);
        videoCache._populated = false;
        videoCache.allStates = {};
        videoCache.episode = "ep01";
        videoCache.episodes = [];
        videoCache.sourceImages = [];
        videoCache.loaded = false;
      }
      setLoaded(true);
    })();
  }, []);

  // ── Auto-save on state change ──
  useEffect(() => {
    if (!loaded) return;
    saveAllStatesAsync(allStates);
    localStorage.setItem("feicai-video-active-ep", episode);
  }, [allStates, episode, loaded]);

  // ── 将组件状态同步到模块级缓存（跨导航保持）──
  useEffect(() => {
    videoCache._populated = true;
    videoCache.allStates = allStates;
    videoCache.episode = episode;
    videoCache.episodes = episodes;
    videoCache.sourceImages = sourceImages;
    videoCache.loaded = loaded;
    videoCache.videoModels = videoModels;
  });

  // ── 注册模块级 state setter（使生成任务能跨导航更新 React state）──
  useEffect(() => {
    moduleSetAllStates = setAllStates;
    return () => { moduleSetAllStates = null; };
  });

  // ── ★ mount 时显示后台完成/失败通知 + 注册 beforeunload 防护 ──
  useEffect(() => {
    // 显示后台生成任务的结果（组件 unmount 期间完成的）
    if (backgroundResults.length > 0) {
      for (const r of backgroundResults) {
        const prefix = r.ep.toUpperCase();
        toast(
          r.ok
            ? `✅ ${prefix} ${r.label} 视频已在后台生成完成！`
            : `❌ ${prefix} ${r.label} 后台生成失败${r.detail ? `：${r.detail}` : ""}`,
          r.ok ? "success" : "error",
        );
      }
      backgroundResults.length = 0;
    }
    // 确保 beforeunload 状态正确
    syncBeforeUnload();
    return () => { syncBeforeUnload(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 恢复时：将卡在 "generating" 的视频卡标记为中断 ──
  useEffect(() => {
    if (!videoCache._populated) return;
    // 仅在 mount 时执行一次：找出所有 "generating" 状态的卡片并重置
    let hasStuck = false;
    const patched = { ...allStates };
    for (const ep of Object.keys(patched)) {
      const s = patched[ep];
      if (!s?.videoCards?.length) continue;
      const fixed = s.videoCards.map((c: VideoCard) => {
        if (c.status === "generating") {
          // 若该卡片仍有正在进行的生成任务（跨导航存活），保持 generating 状态
          if (pendingGenerations.has(c.id)) return c;
          hasStuck = true;
          return { ...c, status: "error" as const, progress: 0 };
        }
        return c;
      });
      if (fixed !== s.videoCards) {
        patched[ep] = { ...s, videoCards: fixed };
      }
    }
    if (hasStuck) {
      setAllStates(patched);
      console.warn("[VideoPage] 已重置中断的生成任务（因页面切换导致）");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load source images for current EP + beat ──
  useEffect(() => {
    if (!loaded) return;
    // ★ 新项目时不从磁盘加载旧图片
    const isFresh = localStorage.getItem("feicai-new-project");
    if (isFresh) {
      setSourceImages([
        { key: "fresh-0", url: "", label: "格1" },
        { key: "fresh-1", url: "", label: "格2" },
        { key: "fresh-2", url: "", label: "格3" },
        { key: "fresh-3", url: "", label: "格4" },
      ]);
      return;
    }
    // 竞态保护：快速切换 EP/Beat 时丢弃过期请求
    let stale = false;
    (async () => {
      // Plan C: 从磁盘加载当前集数的宫格图片 URL
      const db = await loadGridImageUrlsFromDisk(episode);
      if (stale) return; // 切换后丢弃旧结果
      const imgs: SourceImage[] = [];
      for (let i = 0; i < 4; i++) {
        const key = `four-${episode}-${epState.selectedBeat}-${i}`;
        const url = db[key] || "";
        imgs.push({ key, label: `格${i + 1}`, url });
      }
      setSourceImages(imgs);
    })();
    return () => { stale = true; };
  }, [episode, epState.selectedBeat, loaded]);

  // ── Auto-load four-grid scene prompts → single mode per-cell prompts ──
  useEffect(() => {
    if (!loaded) return;
    // ★ 新项目时不加载旧项目的提示词文件
    if (localStorage.getItem("feicai-new-project")) return;
    (async () => {
      try {
        const content = await fetchOptionalOutputContent(`sequence-board-prompt-${episode}.md`);
        if (!content) return;
        const groups = parseFourGridScenePrompts(content);
        if (groups.length === 0) return;
        setAllStates(prev => {
          const cur = prev[episode] || { ...defaultEpState };
          const existing = cur.singleCellPrompts || {};
          const updated = { ...existing };
          let changed = false;
          groups.forEach((scenes, beatIdx) => {
            scenes.forEach((scene, gridIdx) => {
              const key = `b${beatIdx}-g${gridIdx}`;
              if (!existing[key] && scene) {
                updated[key] = scene;
                changed = true;
              }
            });
          });
          if (!changed) return prev;
          return { ...prev, [episode]: { ...cur, singleCellPrompts: updated } };
        });
      } catch { /* ignore — file may not exist yet */ }
    })();
  }, [episode, loaded]);

  // ── Auto-fix model if not available for current mode ──
  useEffect(() => {
    if (videoModels.length === 0) return;
    if (!selectedModel.modes.includes(epState.mode)) {
      const fallback = availableModels[0];
      if (fallback) setEpState({ modelId: fallback.id });
    }
  }, [epState.mode, videoModels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for storage changes (settings page saves models) ──
  // Note: IndexedDB doesn't fire cross-tab events like localStorage's "storage" event.
  // Use a periodic poll + visibilitychange to refresh models when returning to this tab.
  useEffect(() => {
    const refreshModels = async () => {
      const models = await loadVideoModelsAsync();
      if (models.length > 0) setVideoModels(models);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshModels();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // AgentFAB director-command 事件监听（支持FC全自动助手）
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const cmdHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const { action, params = {}, requestId } = ce.detail || {};
      let success = true;
      let result = "";
      let error = "";
      try {
        switch (action) {
          case "saveVideoState":
            handleSave();
            result = "视频状态已保存";
            break;
          case "clearVideoState":
            handleClear();
            result = "当前EP数据已清除";
            break;
          case "switchVideoEp": {
            const ep = params.episode as string;
            if (ep && episodes.includes(ep)) {
              handleEpChange(ep);
              result = `已切换到 ${ep}`;
            } else if (ep) {
              success = false; error = `EP ${ep} 不存在`;
            }
            break;
          }
          case "quickRelay":
            handleQuickRelay();
            result = "快捷尾帧接力已启动";
            break;
          case "aiVideoPrompt":
            handleAIPrompt();
            result = "AI视频提示词生成已启动";
            break;
          case "exportDialogue":
            handleExportDialogue();
            result = "台词文稿导出已启动";
            break;
          case "exportSmartDialogue":
            handleExportSmartDialogue();
            result = "智能台词文稿导出已启动";
            break;
          case "switchVideoModel": {
            const modelId = params.modelId as string;
            if (modelId) {
              setEpState({ modelId });
              result = `已切换视频模型为 ${modelId}`;
            }
            break;
          }
          case "generateVideo":
            handleGenerateVideo();
            result = "视频生成已启动";
            break;
          default:
            success = false;
            error = `Video页未实现的操作: ${action}`;
        }
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : "执行异常";
      }
      window.dispatchEvent(new CustomEvent("director-result", {
        detail: { requestId, success, result, error },
      }));
    };
    window.addEventListener("director-command", cmdHandler);
    return () => { window.removeEventListener("director-command", cmdHandler); };
  }); // 不加 deps — 每次渲染都用最新闭包

  // ═══════════════════════════════════════════════════════════
  // EP Switching
  // ═══════════════════════════════════════════════════════════

  const handleEpChange = (newEp: string) => {
    setEpisode(newEp);
  };

  const handleEpPrev = () => {
    const idx = episodes.indexOf(episode);
    if (idx > 0) handleEpChange(episodes[idx - 1]);
  };
  const handleEpNext = () => {
    const idx = episodes.indexOf(episode);
    if (idx < episodes.length - 1) handleEpChange(episodes[idx + 1]);
  };

  // ═══════════════════════════════════════════════════════════
  // Save & Clear
  // ═══════════════════════════════════════════════════════════

  const handleSave = () => {
    saveAllStatesAsync(allStates);
    toast("视频工作台状态已保存", "success");
  };

  const handleClear = () => {
    if (!confirm("确定要清除当前EP的所有视频生成数据吗？\n此操作不可撤消。")) return;
    setAllStates((prev) => {
      const next = { ...prev };
      delete next[episode];
      return next;
    });
    // 同步清除组件级状态（源图、播放、预览等）
    setSourceImages([
      { key: "clear-0", url: "", label: "格1" },
      { key: "clear-1", url: "", label: "格2" },
      { key: "clear-2", url: "", label: "格3" },
      { key: "clear-3", url: "", label: "格4" },
    ]);
    setIsPlaying(false);
    setShowFrameCapture(false);
    setTimelineDeleteMode(false);
    setPromptPickerOpen(false);
    setCurrentTime(0);
    setVideoDuration(0);
    toast("已清除当前EP数据", "success");
  };

  // ═══════════════════════════════════════════════════════════
  // Video Generation
  // ═══════════════════════════════════════════════════════════

  const handleGenerateVideo = async () => {
    if (!selectedModel.apiKey) {
      toast("请先在设置页配置视频模型的 API Key", "error");
      return;
    }

    // ── Batch Relay Mode: generate 3 relay videos sequentially ──
    if (epState.mode === "batchRelay") {
      const imgs = sourceImages.filter((s) => s.url);
      if (imgs.length < 4) {
        toast(`批量接力需要4张源图片，当前仅有${imgs.length}张。请先从四宫格导入。`, "error");
        return;
      }
      const pairs: { key: "ab" | "bc" | "cd"; label: string; firstIdx: number; lastIdx: number }[] = [
        { key: "ab", label: "A→B", firstIdx: 0, lastIdx: 1 },
        { key: "bc", label: "B→C", firstIdx: 1, lastIdx: 2 },
        { key: "cd", label: "C→D", firstIdx: 2, lastIdx: 3 },
      ];
      const brPrompts = epState.batchRelayPrompts || { ab: "", bc: "", cd: "" };

      for (const pair of pairs) {
        let firstImg = sourceImages[pair.firstIdx].url;
        let lastImg = sourceImages[pair.lastIdx].url;
        if (!firstImg || !lastImg) { toast(`缺少接力图片 ${pair.label}`, "error"); continue; }

        firstImg = await resizeImageForVision(firstImg, 1280);
        lastImg = await resizeImageForVision(lastImg, 1280);

        const newCardId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const pairPrompt = brPrompts[pair.key] || "Generate a smooth and natural transition video";

        setAllStates((prev) => {
          const cur = prev[episode] || { ...defaultEpState };
          const newCard: VideoCard = { id: newCardId, label: pair.label, status: "generating", progress: 0 };
          return { ...prev, [episode]: { ...cur, videoCards: [...cur.videoCards, newCard], activeCardId: newCardId } };
        });

        pendingGenerations.add(newCardId);
        startProgressTimer(episode, newCardId);
        syncBeforeUnload();
        const taskId = `video-${episode}-${newCardId}-${Date.now()}`;
        addTask({ id: taskId, type: "video", label: `${episode.toUpperCase()} ${pair.label} 接力视频`, detail: `${selectedModel.name} · 批量接力` });

        try {
          const body: Record<string, unknown> = {
            apiKey: selectedModel.apiKey, baseUrl: selectedModel.url,
            model: selectedModel.model || selectedModel.name, prompt: pairPrompt,
            inputImage: firstImg, endImage: lastImg,
            duration: parseFloat(effectiveDuration),
            ratio: effectiveRatio, resolution: effectiveResolution,
            motionStrength: epState.motionStrength, mode: "firstlast",
            provider: selectedModel.provider || "third-party",
          };

          const res = await fetch("/api/video/generate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (res.ok) {
            const data = await res.json();
            const videoUrl = data.videoUrl || data.video_url || data.video || data.url || "";
            if (videoUrl) {
              stopProgressTimer(newCardId);
              const usedModel = (selectedModel.model || selectedModel.name) || "";
              moduleUpdateCard(episode, newCardId, { status: "ready", progress: 100, videoUrl, thumbnailUrl: data.thumbnailUrl || firstImg, modelName: usedModel });
              if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: true });
              toast(`${pair.label} 接力视频生成完成！`, "success");
              // Persist to local disk
              const videoKey = `video-${episode}-${newCardId}`;
              let persistedVideoUrl = videoUrl;
              let persistedVideoPath = "";
              try {
                const saveRes = await fetch("/api/local-file", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ category: "videos", key: videoKey, data: videoUrl, type: "video" }),
                });
                if (saveRes.ok) {
                  const saveData = await saveRes.json();
                  persistedVideoUrl = `/api/local-file/videos/${videoKey}`;
                  persistedVideoPath = saveData.path || "";
                  moduleUpdateCard(episode, newCardId, { videoUrl: persistedVideoUrl });
                }
              } catch { /* persist failed */ }
              // Persist thumbnail
              const thumbKey = `thumb-${episode}-${newCardId}`;
              let persistedThumbUrl = data.thumbnailUrl || firstImg;
              let persistedThumbPath = "";
              try {
                const thumbRes = await fetch("/api/local-file", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ category: "video-frames", key: thumbKey, data: data.thumbnailUrl || firstImg, type: "image" }),
                });
                if (thumbRes.ok) {
                  const thumbData = await thumbRes.json();
                  persistedThumbUrl = `/api/local-file/video-frames/${thumbKey}`;
                  persistedThumbPath = thumbData.path || "";
                }
              } catch { /* ignore */ }
              await persistVideoProvenance({
                title: `${episode.toUpperCase()} ${pair.label} 接力视频`,
                stage: "batch-relay",
                prompt: pairPrompt,
                videoOutputs: [{ key: videoKey, url: persistedVideoUrl, path: persistedVideoPath, label: pair.label }],
                frameOutputs: [{ key: thumbKey, url: persistedThumbUrl, path: persistedThumbPath, label: `${pair.label} 缩略图` }],
                inputImages: [
                  { label: "起始帧", url: firstImg },
                  { label: "结束帧", url: lastImg },
                ],
                endImage: { label: "结束帧", url: lastImg },
                context: {
                  cardId: newCardId,
                  pairKey: pair.key,
                  pairLabel: pair.label,
                },
              });
            } else {
              stopProgressTimer(newCardId);
              moduleUpdateCard(episode, newCardId, { status: "error", progress: 0, thumbnailUrl: firstImg });
              if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: data.message || "API未返回视频URL" });
              toast(`${pair.label} 视频生成异常: ${data.message || "API未返回视频URL"}`, "error");
            }
          } else {
            const err = await res.json().catch(() => ({}));
            stopProgressTimer(newCardId);
            moduleUpdateCard(episode, newCardId, { status: "error", progress: 0 });
            if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: err.message || err.error || res.statusText });
            toast(`${pair.label} 生成失败: ${err.message || err.error || res.statusText}`, "error");
          }
        } catch (e) {
          stopProgressTimer(newCardId);
          moduleUpdateCard(episode, newCardId, { status: "error", progress: 0 });
          if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: e instanceof Error ? e.message : "网络错误" });
          toast(`${pair.label} 生成失败: ${e instanceof Error ? e.message : "网络错误"}`, "error");
        } finally {
          pendingGenerations.delete(newCardId);
          syncBeforeUnload();
          removeTask(taskId);
        }
      }
      toast("批量接力生成任务已完成", "success");
      return;
    }

    let inputImageUrl = "";
    let endImageUrl = "";
    const refUrls: string[] = [];

    if (epState.mode === "single") {
      const src = sourceImages[epState.selectedGrid];
      if (!src?.url) { toast("请先选择一张源图片", "error"); return; }
      inputImageUrl = src.url;
    } else if (epState.mode === "firstlast") {
      if (!epState.firstFrameUrl) { toast("请先选择首帧图片", "error"); return; }
      inputImageUrl = epState.firstFrameUrl;
      endImageUrl = epState.lastFrameUrl;
    } else {
      const refs = epState.refImages.filter((r) => r.url);
      if (refs.length === 0) { toast("请至少添加一张参考图", "error"); return; }
      refUrls.push(...refs.map((r) => r.url));
      inputImageUrl = refUrls[0];
    }

    // Compress images before sending to reduce payload (prevents 504/413 from large images)
    console.log(`[Video] Original image size: ${(inputImageUrl.length / 1024).toFixed(0)}KB`);
    inputImageUrl = await resizeImageForVision(inputImageUrl, 1280);
    console.log(`[Video] Compressed image size: ${(inputImageUrl.length / 1024).toFixed(0)}KB`);
    if (endImageUrl) {
      endImageUrl = await resizeImageForVision(endImageUrl, 1280);
    }
    if (refUrls.length > 0) {
      for (let i = 0; i < refUrls.length; i++) {
        refUrls[i] = await resizeImageForVision(refUrls[i], 1280);
      }
    }

    // Always create a new card for this generation (concurrent-safe via functional updater)
    const newCardId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cardId = newCardId;
    const modeLabel = epState.mode === "single" ? "单图" : epState.mode === "firstlast" ? "首尾帧" : "多参考";
    let activeLabel = "";

    setAllStates((prev) => {
      const cur = prev[episode] || { ...defaultEpState };
      const cardNum = cur.videoCards.length + 1;
      activeLabel = `格${cardNum}`;
      const newCard: VideoCard = { id: newCardId, label: `格${cardNum}`, status: "generating", progress: 0 };
      return { ...prev, [episode]: { ...cur, videoCards: [...cur.videoCards, newCard], activeCardId: newCardId } };
    });
    // Fallback label (in case updater hasn't run yet)
    if (!activeLabel) activeLabel = `格${epState.videoCards.length + 1}`;

    // Add to global task queue
    pendingGenerations.add(cardId);
    startProgressTimer(episode, cardId);
    syncBeforeUnload();
    const taskId = `video-${episode}-${cardId}-${Date.now()}`;
    addTask({ id: taskId, type: "video", label: `${episode.toUpperCase()} ${activeLabel} 视频生成`, detail: `${selectedModel.name} · ${modeLabel}模式` });

    // ★ Sora 角色: 如果选中了角色，自动在提示词前注入 @username
    let finalPrompt = currentPrompt;
    if (isCurrentModelSora && selectedSoraCharIds.length > 0) {
      const mentions = selectedSoraCharIds
        .map(id => soraCharacters.find(c => c.id === id))
        .filter(Boolean)
        .map(c => `@${c!.username}`)
        .join(" ");
      if (mentions && !finalPrompt.includes("@")) {
        finalPrompt = `${mentions} ${finalPrompt}`;
        console.log(`[Video] Sora 角色注入: ${mentions}`);
      }
    }

    try {
      const body: Record<string, unknown> = {
        apiKey: selectedModel.apiKey, baseUrl: selectedModel.url,
        model: selectedModel.model || selectedModel.name, prompt: finalPrompt || "生成一段自然流畅的视频",
        inputImage: inputImageUrl, duration: parseFloat(effectiveDuration),
        ratio: effectiveRatio, resolution: effectiveResolution,
        motionStrength: epState.motionStrength, mode: epState.mode,
        provider: selectedModel.provider || "third-party",
      };
      if (endImageUrl) body.endImage = endImageUrl;
      if (refUrls.length > 1) body.referenceImages = refUrls;

      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        console.log("[Video Generate] Response data:", JSON.stringify(data).slice(0, 500));
        const videoUrl = data.videoUrl || data.video_url || data.video || data.url || "";

        if (videoUrl) {
          // Show card as ready immediately with CDN URL
          stopProgressTimer(cardId);
          const usedModel = (selectedModel.model || selectedModel.name) || "";
          moduleUpdateCard(episode, cardId, {
            status: "ready", progress: 100, videoUrl, thumbnailUrl: data.thumbnailUrl || inputImageUrl,
            apiTaskId: data.apiTaskId || "", modelName: usedModel,
          });
          // ★ 若组件已卸载，记录后台完成结果（re-mount 时通知用户）
          if (!moduleSetAllStates) {
            backgroundResults.push({ ep: episode, label: activeLabel, ok: true });
          }
          toast(`${activeLabel} 视频生成完成！`, "success");
          // Persist video to local disk, then switch to local serving URL for reliable browser playback
          // CDN URLs may not be accessible from the browser (temp tokens, IP restrictions, CORS, etc.)
          const videoKey = `video-${episode}-${cardId}`;
          let persistedVideoUrl = videoUrl;
          let persistedVideoPath = "";
          try {
            const saveRes = await fetch("/api/local-file", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category: "videos", key: videoKey, data: videoUrl, type: "video" }),
            });
            if (saveRes.ok) {
              const saveData = await saveRes.json();
              console.log(`[persistVideo] ✓ saved ${videoKey} (${saveData.sizeMB || "?"}MB)`);
              persistedVideoUrl = `/api/local-file/videos/${videoKey}`;
              persistedVideoPath = saveData.path || "";
              moduleUpdateCard(episode, cardId, { videoUrl: persistedVideoUrl });
            } else {
              console.warn(`[persistVideo] ✗ save failed: ${saveRes.status}`);
            }
          } catch (e) {
            console.warn(`[persistVideo] ✗ ${videoKey}:`, e);
          }
          // Persist thumbnail to local disk so it survives restart
          const thumbSrc = data.thumbnailUrl || inputImageUrl;
          let persistedThumbUrl = thumbSrc;
          let persistedThumbPath = "";
          let thumbKey = "";
          if (thumbSrc) {
            thumbKey = `thumb-${episode}-${cardId}`;
            // For data URLs, save directly; for HTTP URLs, fetch & save
            const thumbData = thumbSrc.startsWith("data:") ? thumbSrc : thumbSrc;
            try {
              const thumbRes = await fetch("/api/local-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: "video-frames", key: thumbKey, data: thumbData, type: "image" }),
              });
              if (thumbRes.ok) {
                const savedThumb = await thumbRes.json();
                console.log(`[persistThumb] ✓ saved ${thumbKey}`);
                persistedThumbUrl = `/api/local-file/video-frames/${thumbKey}`;
                persistedThumbPath = savedThumb.path || "";
                moduleUpdateCard(episode, cardId, { thumbnailUrl: persistedThumbUrl });
              }
            } catch (e) {
              console.warn(`[persistThumb] ✗ ${thumbKey}:`, e);
            }
          }
          await persistVideoProvenance({
            title: `${episode.toUpperCase()} ${activeLabel} 视频生成`,
            stage: epState.mode,
            prompt: finalPrompt || "生成一段自然流畅的视频",
            videoOutputs: [{ key: videoKey, url: persistedVideoUrl, path: persistedVideoPath, label: activeLabel }],
            frameOutputs: thumbSrc && thumbKey
              ? [{ key: thumbKey, url: persistedThumbUrl, path: persistedThumbPath, label: `${activeLabel} 缩略图` }]
              : [],
            inputImages: inputImageUrl ? [{ label: "输入图", url: inputImageUrl }] : [],
            referenceImages: refUrls.map((url, index) => ({ label: `参考图${index + 1}`, url })),
            endImage: endImageUrl ? { label: "尾帧", url: endImageUrl } : null,
            context: {
              cardId,
              activeLabel,
              apiTaskId: data.apiTaskId || "",
              selectedGridLabel: sourceImages[epState.selectedGrid]?.label || "",
            },
          });
          // Also persist the input source image as a frame
          if (inputImageUrl) persistVideoFrameToLocal(`input-${episode}-${cardId}`, inputImageUrl);
        } else {
          const msg = data.message || "API未返回视频URL";
          const raw = data.rawResponse ? JSON.stringify(data.rawResponse).slice(0, 300) : "";
          stopProgressTimer(cardId);
          moduleUpdateCard(episode, cardId, { status: "error", progress: 0, thumbnailUrl: inputImageUrl });
          if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: activeLabel, ok: false, detail: msg });
          toast(`视频生成异常: ${msg}${raw ? `\n调试信息: ${raw}` : ""}`, "error");
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn("[Video Generate] Error response:", res.status, err);
        const errMsg = err.message || err.error || res.statusText;
        const rawSnippet = err.rawResponse ? JSON.stringify(err.rawResponse).slice(0, 300) : "";
        stopProgressTimer(cardId);
        moduleUpdateCard(episode, cardId, { status: "error", progress: 0 });
        if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: activeLabel, ok: false, detail: errMsg });
        toast(`视频生成失败: ${errMsg}${rawSnippet ? `\n调试: ${rawSnippet}` : ""}`, "error");
      }
    } catch (e) {
      stopProgressTimer(cardId);
      moduleUpdateCard(episode, cardId, { status: "error", progress: 0 });
      if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: activeLabel, ok: false, detail: e instanceof Error ? e.message : "网络错误" });
      toast(`生成失败: ${e instanceof Error ? e.message : "网络错误"}`, "error");
    } finally {
      pendingGenerations.delete(cardId);
      syncBeforeUnload();
      removeTask(taskId);
    }
  };

  // ── Regenerate a single relay pair ──
  const handleRegenerateSingleRelay = async (pairKey: "ab" | "bc" | "cd") => {
    if (!selectedModel.apiKey) { toast("请先在设置页配置视频模型的 API Key", "error"); return; }
    const pairMap: Record<string, { label: string; firstIdx: number; lastIdx: number }> = {
      ab: { label: "A→B", firstIdx: 0, lastIdx: 1 },
      bc: { label: "B→C", firstIdx: 1, lastIdx: 2 },
      cd: { label: "C→D", firstIdx: 2, lastIdx: 3 },
    };
    const pair = pairMap[pairKey];
    const imgs = sourceImages.filter((s) => s.url);
    if (imgs.length < 4) { toast(`批量接力需要4张源图片，当前仅有${imgs.length}张`, "error"); return; }

    let firstImg = sourceImages[pair.firstIdx].url;
    let lastImg = sourceImages[pair.lastIdx].url;
    if (!firstImg || !lastImg) { toast(`缺少接力图片 ${pair.label}`, "error"); return; }

    firstImg = await resizeImageForVision(firstImg, 1280);
    lastImg = await resizeImageForVision(lastImg, 1280);

    const brPrompts = epState.batchRelayPrompts || { ab: "", bc: "", cd: "" };
    const pairPrompt = brPrompts[pairKey] || "Generate a smooth and natural transition video";
    const newCardId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    setAllStates((prev) => {
      const cur = prev[episode] || { ...defaultEpState };
      const newCard: VideoCard = { id: newCardId, label: pair.label, status: "generating", progress: 0 };
      return { ...prev, [episode]: { ...cur, videoCards: [...cur.videoCards, newCard], activeCardId: newCardId, batchRelayActiveTab: pairKey } };
    });

    pendingGenerations.add(newCardId);
    startProgressTimer(episode, newCardId);
    syncBeforeUnload();
    const taskId = `video-${episode}-${newCardId}-${Date.now()}`;
    addTask({ id: taskId, type: "video", label: `${episode.toUpperCase()} ${pair.label} 重新生成`, detail: `${selectedModel.name} · 接力重生成` });

    try {
      const body: Record<string, unknown> = {
        apiKey: selectedModel.apiKey, baseUrl: selectedModel.url,
        model: selectedModel.model || selectedModel.name, prompt: pairPrompt,
        inputImage: firstImg, endImage: lastImg,
        duration: parseFloat(effectiveDuration),
        ratio: effectiveRatio, resolution: effectiveResolution,
        motionStrength: epState.motionStrength, mode: "firstlast",
        provider: selectedModel.provider || "third-party",
      };

      const res = await fetch("/api/video/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        const videoUrl = data.videoUrl || data.video_url || data.video || data.url || "";
        if (videoUrl) {
          stopProgressTimer(newCardId);
          const usedModel = (selectedModel.model || selectedModel.name) || "";
          moduleUpdateCard(episode, newCardId, { status: "ready", progress: 100, videoUrl, thumbnailUrl: data.thumbnailUrl || firstImg, modelName: usedModel });
          if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: true });
          toast(`${pair.label} 重新生成完成！`, "success");
          const videoKey = `video-${episode}-${newCardId}`;
          let persistedVideoUrl = videoUrl;
          let persistedVideoPath = "";
          try {
            const saveRes = await fetch("/api/local-file", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category: "videos", key: videoKey, data: videoUrl, type: "video" }),
            });
            if (saveRes.ok) {
              const saveData = await saveRes.json();
              persistedVideoUrl = `/api/local-file/videos/${videoKey}`;
              persistedVideoPath = saveData.path || "";
              moduleUpdateCard(episode, newCardId, { videoUrl: persistedVideoUrl });
            }
          } catch { /* persist failed */ }
          const thumbKey = `thumb-${episode}-${newCardId}`;
          let persistedThumbUrl = data.thumbnailUrl || firstImg;
          let persistedThumbPath = "";
          try {
            const thumbRes = await fetch("/api/local-file", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category: "video-frames", key: thumbKey, data: data.thumbnailUrl || firstImg, type: "image" }),
            });
            if (thumbRes.ok) {
              const thumbData = await thumbRes.json();
              persistedThumbUrl = `/api/local-file/video-frames/${thumbKey}`;
              persistedThumbPath = thumbData.path || "";
            }
          } catch { /* ignore */ }
          await persistVideoProvenance({
            title: `${episode.toUpperCase()} ${pair.label} 接力重生成`,
            stage: "relay-regenerate",
            prompt: pairPrompt,
            videoOutputs: [{ key: videoKey, url: persistedVideoUrl, path: persistedVideoPath, label: pair.label }],
            frameOutputs: [{ key: thumbKey, url: persistedThumbUrl, path: persistedThumbPath, label: `${pair.label} 缩略图` }],
            inputImages: [
              { label: "起始帧", url: firstImg },
              { label: "结束帧", url: lastImg },
            ],
            endImage: { label: "结束帧", url: lastImg },
            context: {
              cardId: newCardId,
              pairKey,
              pairLabel: pair.label,
            },
          });
        } else {
          stopProgressTimer(newCardId);
          moduleUpdateCard(episode, newCardId, { status: "error", progress: 0, thumbnailUrl: firstImg });
          if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: data.message || "API未返回视频URL" });
          toast(`${pair.label} 重新生成异常: ${data.message || "API未返回视频URL"}`, "error");
        }
      } else {
        const err = await res.json().catch(() => ({}));
        stopProgressTimer(newCardId);
        moduleUpdateCard(episode, newCardId, { status: "error", progress: 0 });
        if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: err.message || err.error || res.statusText });
        toast(`${pair.label} 重新生成失败: ${err.message || err.error || res.statusText}`, "error");
      }
    } catch (e) {
      stopProgressTimer(newCardId);
      moduleUpdateCard(episode, newCardId, { status: "error", progress: 0 });
      if (!moduleSetAllStates) backgroundResults.push({ ep: episode, label: pair.label, ok: false, detail: e instanceof Error ? e.message : "网络错误" });
      toast(`${pair.label} 重新生成失败: ${e instanceof Error ? e.message : "网络错误"}`, "error");
    } finally {
      pendingGenerations.delete(newCardId);
      syncBeforeUnload();
      removeTask(taskId);
    }
  };

  const failedVideoCards = useMemo(
    () => epState.videoCards.filter((card) => card.status === "error"),
    [epState.videoCards],
  );

  const videoRecoveryPanelItems = useMemo<WorkflowRecoveryPanelItem[]>(
    () =>
      failedVideoCards.map((card) => ({
        id: card.id,
        label: `${card.label} 生成失败`,
        detail: (card.label === "A→B" || card.label === "B→C" || card.label === "C→D")
          ? "这条接力视频上次没有成功返回结果，可以单独重试这一个接力段。"
          : `当前模式下的 ${card.label} 没有成功生成，可以按当前配置重新拉起。`,
        actionLabel: (card.label === "A→B" || card.label === "B→C" || card.label === "C→D") ? "重试接力段" : "按当前配置重试",
      })),
    [failedVideoCards],
  );

  const dismissVideoFailure = useCallback((cardId: string) => {
    setAllStates((prev) => {
      const cur = prev[episode];
      if (!cur) return prev;
      const nextCards = cur.videoCards.filter((card) => card.id !== cardId);
      const nextActive = cur.activeCardId === cardId ? (nextCards.at(-1)?.id || "") : cur.activeCardId;
      return {
        ...prev,
        [episode]: {
          ...cur,
          videoCards: nextCards,
          activeCardId: nextActive,
        },
      };
    });
  }, [episode]);

  const clearAllVideoFailures = useCallback(() => {
    setAllStates((prev) => {
      const cur = prev[episode];
      if (!cur) return prev;
      const nextCards = cur.videoCards.filter((card) => card.status !== "error");
      const nextActive = nextCards.some((card) => card.id === cur.activeCardId) ? cur.activeCardId : (nextCards.at(-1)?.id || "");
      return {
        ...prev,
        [episode]: {
          ...cur,
          videoCards: nextCards,
          activeCardId: nextActive,
        },
      };
    });
  }, [episode]);

  const retryVideoFailure = useCallback(async (cardId: string) => {
    const card = failedVideoCards.find((item) => item.id === cardId);
    if (!card) return;

    if (card.label === "A→B") {
      await handleRegenerateSingleRelay("ab");
      return;
    }
    if (card.label === "B→C") {
      await handleRegenerateSingleRelay("bc");
      return;
    }
    if (card.label === "C→D") {
      await handleRegenerateSingleRelay("cd");
      return;
    }

    await handleGenerateVideo();
  }, [failedVideoCards, handleRegenerateSingleRelay, handleGenerateVideo]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.pause(); else video.play();
    setIsPlaying(!isPlaying);
  };

  // ── Frame Capture (方案1: modal入口 + 方案3: 快捷接力) ──
  const openFrameCapture = (target: "first" | "last") => {
    setFrameCaptureTarget(target);
    setShowFrameCapture(true);
  };

  const handleFrameCaptured = (frameDataUrl: string, label: string) => {
    if (frameCaptureTarget === "first") {
      setEpState({ firstFrameUrl: frameDataUrl });
      toast(`已截取 ${label} 作为首帧`, "success");
      persistVideoFrameToLocal(`first-${episode}-${Date.now()}`, frameDataUrl);
    } else {
      setEpState({ lastFrameUrl: frameDataUrl });
      toast(`已截取 ${label} 作为尾帧`, "success");
      persistVideoFrameToLocal(`last-${episode}-${Date.now()}`, frameDataUrl);
    }
  };

  /**
   * Try to capture a frame directly from the already-loaded video element.
   * This avoids re-downloading the entire video from CDN.
   * Falls back to blob download if canvas is tainted (CORS).
   */
  const captureFrameFromRef = async (videoEl: HTMLVideoElement, seekToEnd: boolean): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const draw = () => {
        if (settled) return;
        try {
          const w = videoEl.videoWidth || 1280;
          const h = videoEl.videoHeight || 720;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(videoEl, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          if (dataUrl.length < 1000) throw new Error("帧数据异常");
          settled = true;
          resolve(dataUrl);
        } catch (e) {
          if (!settled) { settled = true; reject(e); }
        }
      };

      if (!seekToEnd) {
        draw();
        return;
      }

      // Seek to near-end, then capture
      const prevTime = videoEl.currentTime;
      const onSeeked = () => {
        videoEl.removeEventListener("seeked", onSeeked);
        if (settled) return;
        // Wait a frame for decode
        if ("requestVideoFrameCallback" in videoEl) {
          (videoEl as unknown as { requestVideoFrameCallback: (cb: () => void) => void })
            .requestVideoFrameCallback(draw);
        } else {
          setTimeout(draw, 150);
        }
      };
      videoEl.addEventListener("seeked", onSeeked);
      videoEl.currentTime = Math.max(0, videoEl.duration - 0.05);

      // Timeout for seek — 防止 seeked 事件不触发时永久挂起
      setTimeout(() => {
        videoEl.removeEventListener("seeked", onSeeked);
        if (settled) return;
        try { draw(); } catch { if (!settled) { settled = true; reject(new Error("seek超时")); } }
      }, 5000);
    });
  };

  /** 方案3: 快捷尾帧接力 — 截取当前视频最后一帧 → 设为首帧，自动切换首尾帧模式 */
  const handleQuickRelay = async () => {
    if (!activeVideoUrl) { toast("当前没有可用视频", "error"); return; }
    toast("正在截取视频尾帧...", "info");
    try {
      let frame: string;

      // Strategy 1: Capture directly from the already-loaded video element (instant, no re-download)
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          frame = await captureFrameFromRef(videoRef.current, true);
          console.log("[QuickRelay] Captured from videoRef directly");
        } catch (refErr) {
          // Tainted canvas or other error — fall back to blob download
          console.warn("[QuickRelay] Direct capture failed, falling back to blob download:", refErr);
          frame = await captureFrameFromVideo(activeVideoUrl, -1, { episode });
        }
      } else {
        // Video element not ready — must download
        frame = await captureFrameFromVideo(activeVideoUrl, -1, { episode });
      }

      // Switch to firstlast mode if not already
      if (epState.mode !== "firstlast") {
        setEpState({ mode: "firstlast" as VideoMode, firstFrameUrl: frame });
        toast("已截取尾帧作为首帧，已切换到首尾帧模式", "success");
      } else {
        setEpState({ firstFrameUrl: frame });
        toast("已截取尾帧作为下一段首帧", "success");
      }
      // Persist captured frame to local disk
      persistVideoFrameToLocal(`relay-${episode}-${Date.now()}`, frame);
    } catch (e) {
      toast(`截帧失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
  };

  const openImportModal = (target: "single" | "first" | "last" | "multiref") => {
    setImportTarget(target);
    setShowImportModal(true);
  };

  const handleImportImages = (images: { key: string; url: string; label: string }[], deselectedKeys?: Set<string>) => {
    if (importTarget === "first") {
      if (images.length === 0) return;
      setEpState({ firstFrameUrl: images[0].url });
      toast("已导入首帧图片", "success");
      return;
    }
    if (importTarget === "last") {
      if (images.length === 0) return;
      setEpState({ lastFrameUrl: images[0].url });
      toast("已导入尾帧图片", "success");
      return;
    }
    if (epState.mode === "multiref" || importTarget === "multiref") {
      if (images.length === 0) return;
      const refs = images.map((img) => ({ url: img.url, label: img.label.split("·")[0]?.trim() || "参考" }));
      setEpState({ refImages: [...epState.refImages, ...refs].slice(0, 5) });
      toast(`已导入 ${images.length} 张参考图`, "success");
    } else if (epState.mode === "batchRelay") {
      // Batch Relay — 完全替换所有4个槽位: 先清空，再从slot 0按顺序填入
      const newSources = [...sourceImages];
      // 清空所有被取消选择的槽位
      for (let i = 0; i < newSources.length; i++) {
        if (deselectedKeys && deselectedKeys.has(newSources[i].key)) {
          newSources[i] = { ...newSources[i], url: "" };
          deleteGridImageFromDisk(newSources[i].key);
        }
      }
      // 填入选中的图片 — 按key匹配或按序填入空槽
      let filled = 0;
      for (const img of images) {
        // 先尝试按key匹配精确位置
        const matchIdx = newSources.findIndex((s) => s.key === img.key);
        if (matchIdx >= 0 && !newSources[matchIdx].url) {
          newSources[matchIdx] = { ...newSources[matchIdx], url: img.url };
          saveOneGridImageToDisk(newSources[matchIdx].key, img.url);
          filled++;
        } else if (matchIdx >= 0 && newSources[matchIdx].url) {
          // 已有URL (未被deselect)，保持不变
          filled++;
        } else {
          // 按序填入第一个空槽
          const emptyIdx = newSources.findIndex((s) => !s.url);
          if (emptyIdx >= 0) {
            newSources[emptyIdx] = { ...newSources[emptyIdx], url: img.url };
            saveOneGridImageToDisk(newSources[emptyIdx].key, img.url);
            filled++;
          }
        }
      }
      setSourceImages(newSources);
      toast(`已更新接力源图片 (${newSources.filter(s => s.url).length}/4)`, "success");
    } else {
      // Single mode — 从 selectedGrid 开始逐格填充
      if (images.length === 0 && deselectedKeys && deselectedKeys.size > 0) {
        // 处理取消选择: 清除匹配的图片
        const newSources = [...sourceImages];
        for (let i = 0; i < newSources.length; i++) {
          if (deselectedKeys.has(newSources[i].key)) {
            newSources[i] = { ...newSources[i], url: "" };
            deleteGridImageFromDisk(newSources[i].key);
          }
        }
        setSourceImages(newSources);
        toast("已更新源图片", "success");
        return;
      }
      if (images.length > 0) {
        const newSources = [...sourceImages];
        let filled = 0;
        for (let slot = epState.selectedGrid; slot < newSources.length && filled < images.length; slot++) {
          newSources[slot] = { ...newSources[slot], url: images[filled].url };
          saveOneGridImageToDisk(newSources[slot].key, images[filled].url);
          filled++;
        }
        setSourceImages(newSources);
        setEpState({ selectedGrid: epState.selectedGrid });
        toast(`已导入 ${filled} 张图片到格${epState.selectedGrid + 1}`, "success");
      }
    }
  };

  const handleOpenAIPromptModal = useCallback(() => {
    if (epState.mode === "single") {
      toast("单图模式请使用「选择分镜」获取提示词", "info");
      return;
    }
    setAiPromptModalOpen(true);
  }, [epState.mode, toast]);

  const handleAIPrompt = async (options?: { modelId?: string; outputLanguage?: PromptLanguage; dialogues?: ImportedDialogue[] }) => {
    // Single mode uses four-grid scene descriptions, not AI generation
    if (epState.mode === "single") { toast("单图模式请使用「选择分镜」获取提示词", "info"); return; }

    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore corrupt data */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    // Collect selected images for multimodal analysis
    const imageUrls: string[] = [];
    if (epState.mode === "batchRelay") {
      // For batch relay, use the two images of the active pair tab
      const tab = epState.batchRelayActiveTab || "ab";
      const pairIdxMap = { ab: [0, 1], bc: [1, 2], cd: [2, 3] };
      const [fi, li] = pairIdxMap[tab];
      if (sourceImages[fi]?.url) imageUrls.push(sourceImages[fi].url);
      if (sourceImages[li]?.url) imageUrls.push(sourceImages[li].url);
    } else if (epState.mode === "firstlast") {
      if (epState.firstFrameUrl) imageUrls.push(epState.firstFrameUrl);
      if (epState.lastFrameUrl) imageUrls.push(epState.lastFrameUrl);
    } else {
      epState.refImages.filter((r) => r.url).slice(0, 14).forEach((r) => imageUrls.push(r.url));
    }

    if (imageUrls.length === 0) {
      toast("请先选择或上传图片，再生成动态提示词", "error");
      return;
    }

    const promptTargetModel = videoModels.find((item) => item.id === options?.modelId) || selectedModel;
    const promptProfile = resolveVideoPromptProfile(promptTargetModel.model || promptTargetModel.name);
    const outputLanguage = options?.outputLanguage || promptProfile.language;
    const selectedDialogues = options?.dialogues || [];

    if (options?.modelId && options.modelId !== epState.modelId && videoModels.some((item) => item.id === options.modelId)) {
      setEpState({ modelId: options.modelId });
    }

    toast("AI正在分析图片并生成动态提示词...", "info");

    // Resize images to reduce payload — use 512px to keep under proxy size limits
    const resizedImages = await Promise.all(imageUrls.map((u) => resizeImageForVision(u, 512)));
    // Validate: all images should be data URLs after resize; log warnings for any that aren't
    const nonDataUrls = resizedImages.filter(u => !u.startsWith("data:"));
    if (nonDataUrls.length > 0) {
      console.warn("[AI Prompt] Some images failed to convert to base64:", nonDataUrls.map(u => u.slice(0, 80)));
      // Attempt fetch-based fallback for non-data URLs
      for (let i = 0; i < resizedImages.length; i++) {
        if (!resizedImages[i].startsWith("data:")) {
          try {
            const fetchRes = await fetch(resizedImages[i]);
            if (fetchRes.ok) {
              const blob = await fetchRes.blob();
              resizedImages[i] = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => resolve(resizedImages[i]);
                reader.readAsDataURL(blob);
              });
            }
          } catch { /* keep original */ }
        }
      }
    }
    console.log(`[AI Prompt] Sending ${resizedImages.length} images (sizes: ${resizedImages.map(u => `${Math.round(u.length / 1024)}KB`).join(", ")})`);
    const aiTaskId = `llm-prompt-${episode}-${Date.now()}`;
    const pairLabelsForTask: Record<string, string> = { ab: "A+B", bc: "B+C", cd: "C+D" };
    const taskDetail = epState.mode === "batchRelay"
      ? `批量接力 · ${pairLabelsForTask[epState.batchRelayActiveTab || "ab"]}`
      : epState.mode === "firstlast" ? "首尾帧模式" : "多参考模式";
    addTask({ id: aiTaskId, type: "llm", label: `${episode.toUpperCase()} ${epState.mode === "batchRelay" ? "批量接力AI提示词" : "AI动态提示词"}`, detail: taskDetail });
    try {
      // Load motion prompt system prompt
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          systemPrompt = saved.motionPrompt || "";
        }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        try {
          const promptRes = await fetch("/api/prompts");
          if (promptRes.ok) { const pd = await promptRes.json(); systemPrompt = pd.motionPrompt || ""; }
        } catch { /* ignore */ }
      }

      // ── Gather story/scene context ──
      const contextParts: string[] = [];

      // 1. Consistency profile (characters, scenes, style)
      try {
        const cstRaw = await kvLoad("feicai-consistency");
        if (cstRaw) {
          const cst = JSON.parse(cstRaw);
          if (cst.characters?.length > 0) {
            contextParts.push("【角色信息】\n" + cst.characters.map((c: { name: string; description: string }) =>
              `- ${c.name}：${c.description}`).join("\n"));
          }
          if (cst.scenes?.length > 0) {
            contextParts.push("【场景信息】\n" + cst.scenes.map((s: { name: string; description: string }) =>
              `- ${s.name}：${s.description}`).join("\n"));
          }
          if (cst.style) {
            const st = cst.style;
            const styleDatabaseSummary = buildStyleDatabaseSummary(st);
            contextParts.push(`【视觉风格】画风：${st.artStyle || "未设定"}，色调：${st.colorPalette || "未设定"}${styleDatabaseSummary ? `，风格组合：${styleDatabaseSummary}` : ""}${st.stylePrompt ? `，风格提示：${st.stylePrompt}` : ""}`);
          }
        }
      } catch { /* ignore */ }

      // 2. Beat breakdown for current beat group
      try {
        const bbRes = await fetch(`/api/outputs/beat-breakdown.md`);
        if (bbRes.ok) {
          const bbData = await bbRes.json();
          const bbContent = bbData.content || "";
          if (bbContent) {
            const beatNum = epState.selectedBeat + 1;
            const beatSection = bbContent.split(/##\s*格?\s*\d/i).slice(beatNum, beatNum + 1).join("") || "";
            contextParts.push(`【节拍拆解 - 组${beatNum}】\n${beatSection.trim().slice(0, 600) || "(暂无此组的节拍拆解)"}`);
          }
        }
      } catch { /* ignore */ }

      // 3. Sequence board prompt for current beat
      try {
        const sbContent = await fetchOptionalOutputContent(`sequence-board-prompt-${episode}.md`);
        if (sbContent) {
          const beatNum = epState.selectedBeat + 1;
          const sections = sbContent.split(/##\s*格\s*(\d+)/);
          let beatText = "";
          for (let i = 1; i < sections.length; i += 2) {
            if (parseInt(sections[i]) === beatNum && sections[i + 1]) {
              beatText = sections[i + 1].trim().slice(0, 600);
              break;
            }
          }
          if (beatText) {
            contextParts.push(`【四宫格分镜 - 组${beatNum}】\n${beatText}`);
          }
        }
      } catch { /* ignore */ }

      // 4. Imported dialogues for current beat
      if (selectedDialogues.length > 0) {
        contextParts.push(
          [
            `【关联台词】`,
            ...selectedDialogues.map((item) => {
              const meta = [item.emotion, item.strength, item.speed, item.voiceQuality].filter(Boolean).join(" · ");
              return `- ${item.role}：${item.text}${meta ? `（${meta}）` : ""}`;
            }),
          ].join("\n"),
        );
      }

      // 5. Build mode-specific user message (firstlast / multiref / batchRelay)
      const modeLabel = epState.mode === "firstlast" ? "首尾帧过渡" : epState.mode === "batchRelay" ? "批量接力过渡" : "多参考图融合";
      let modeInstruction = "";

      if (epState.mode === "batchRelay") {
        const pairLabels: Record<string, string> = { ab: "A→B", bc: "B→C", cd: "C→D" };
        const pairNames: Record<string, [string, string]> = { ab: ["A", "B"], bc: ["B", "C"], cd: ["C", "D"] };
        const activeTab = epState.batchRelayActiveTab || "ab";
        const [nameFirst, nameSecond] = pairNames[activeTab];
        modeInstruction = [
          `模式：批量接力过渡（Batch Relay · ${pairLabels[activeTab]}）`,
          `我已附上2张图片：第一张是格子${nameFirst}的画面，第二张是格子${nameSecond}的画面。`,
          `请分析从${nameFirst}到${nameSecond}两个画面之间的变化，然后生成一段平滑衔接的过渡动态提示词。`,
          `重点：`,
          `- 仔细对比两张图片的差异（人物位置/姿态变化、表情变化、光线/色调变化、场景构图变化）`,
          `- 设计自然流畅的过渡运动来衔接这两个画面状态`,
          `- 注意运动路径的合理性和物理真实感`,
          `- 参考剧情上下文，确保过渡动态服务于叙事逻辑`,
          `- 公式：过渡起止描述 + 核心变化要素 + 运动轨迹 + 镜头运动 + 节奏感`,
        ].join("\n");
      } else if (epState.mode === "firstlast") {
        modeInstruction = [
          `模式：首尾帧过渡（First-Last Frame → Video）`,
          `我已附上${imageUrls.length}张图片（首帧+尾帧）。`,
          `请对比两帧图片的变化，描述从首帧到尾帧之间的过渡动态。`,
          `重点：`,
          `- 识别两帧之间的关键变化（人物位置、表情、光线、场景变化等）`,
          `- 设计平滑的过渡运动来连接两个画面状态`,
          `- 参考剧情中该段的叙事推进，确保过渡符合故事逻辑`,
          `- 公式：过渡描述 + 核心变化 + 运动轨迹 + 节奏`,
        ].join("\n");
      } else {
        modeInstruction = [
          `模式：多参考图融合（Multi-Reference → Video）`,
          `我已附上${imageUrls.length}张参考图片。请综合分析所有图片的内容、风格和构图。`,
          `重点：`,
          `- 融合多图信息，提取主体特征和风格一致性`,
          `- 设计能体现这些参考图共同风格的动态方案`,
          `- 参考剧情中该段的叙事推进，确保动态符合故事逻辑`,
          `- 公式：主体动作 + 风格参考融合 + 镜头运动 + 氛围统一`,
        ].join("\n");
      }

      const userMsg = [
        `请为图生视频场景生成动态提示词（Motion Prompt）：`,
        ``,
        `【模式与图片】`,
        modeInstruction,
        ``,
        `【视频参数】`,
        `- 时长：${effectiveDuration}秒`,
        `- 比例：${effectiveRatio}`,
        `- 当前EP：${episode.toUpperCase()} · 组${epState.selectedBeat + 1}`,
        ``,
        ...(contextParts.length > 0 ? [`【剧情上下文】`, ...contextParts.map((p) => p + "\n")] : []),
        `【要求】`,
        `1. 仔细观察我上传的图片画面内容，作为动态提示词的基础`,
        `2. 结合上方剧情上下文，让Motion Prompt服务于剧情推进`,
        `3. 生成一段可直接使用的Motion Prompt（50-150字）`,
        `4. 包含：具体的镜头运动 + 主体动作 + 速度/节奏 + 氛围`,
        `5. 不要重复描述图片中已有的静态内容`,
        `6. 直接输出提示词文本，中英文结合，不要任何解释`,
      ].join("\n");

      const finalSystemPrompt = [
        systemPrompt,
        promptProfile.systemPromptPatch,
        `## 输出语言`,
        `- 输出语言：严格使用${formatPromptLanguage(outputLanguage)}`,
        `- 输出长度上限：${promptProfile.maxLength} 字符`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: llmSettings["llm-key"] || "",
          baseUrl: (llmSettings["llm-url"] || "").replace(/\/+$/, ""),
          model: llmSettings["llm-model"] || "gemini-2.5-pro",
          provider: llmSettings["llm-provider"] || "openAi",
          ...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
          prompt: userMsg,
          images: resizedImages,
          maxTokens: 4096,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log("[AI Prompt] LLM response:", JSON.stringify(data).slice(0, 500));
        let text = data.content || data.text || data.choices?.[0]?.message?.content || "";
        // Validate: filter out API metadata that got mis-extracted as content
        if (text && /^(chatcmpl|cmpl|run|thread|msg|asst|file|org|sk)-/i.test(text.trim())) {
          console.warn("[AI Prompt] Detected API ID as content, discarding:", text);
          text = "";
        }
        if (text) {
          setCurrentPrompt(text.trim());
          const fallbackNote = data.visionFallback ? "（注：图片未被模型识别，已用纯文本生成）" : "";
          const modeToastLabel = epState.mode === "batchRelay" ? `批量接力·${{ ab: "A+B", bc: "B+C", cd: "C+D" }[epState.batchRelayActiveTab || "ab"]}` : epState.mode === "firstlast" ? "首尾帧" : "多参考";
          toast(`AI提示词已生成（${modeToastLabel}模式 · ${promptProfile.label} · ${formatPromptLanguage(outputLanguage)}${data.visionFallback ? " · 纯文本" : " · 含图片分析"}）${fallbackNote}`, data.visionFallback ? "info" : "success");
        }
        else {
          console.warn("[AI Prompt] Empty content. Full response:", JSON.stringify(data).slice(0, 1000));
          const finishInfo = data.finishReason ? `(finish_reason: ${data.finishReason})` : "";
          const rawHint = data.rawResponse ? `\n原始响应: ${JSON.stringify(data.rawResponse).slice(0, 200)}` : "";
          toast(`AI返回内容为空 ${finishInfo}\n可能原因：当前API代理不支持多模态(Vision)图片识别\n建议：在设置页切换到支持Vision的LLM模型/代理${rawHint}`, "error");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const detail = errData.error || res.statusText || "未知错误";
        console.error("[AI Prompt] LLM error:", detail);
        toast(`AI生成失败: ${typeof detail === "string" ? detail.slice(0, 120) : JSON.stringify(detail).slice(0, 120)}`, "error");
      }
    } catch (e) {
      console.error("[AI Prompt] Exception:", e);
      toast(`AI生成异常: ${e instanceof Error ? e.message : "网络错误"}`, "error");
    } finally { removeTask(aiTaskId); }
  };

  const handleRunAIPromptFromModal = async (options: { modelId?: string; outputLanguage: PromptLanguage; dialogues: ImportedDialogue[] }) => {
    setAiPromptGenerating(true);
    try {
      await handleAIPrompt(options);
      setAiPromptModalOpen(false);
    } finally {
      setAiPromptGenerating(false);
    }
  };

  // ── Computed ──
  const activeCard = epState.videoCards.find((c) => c.id === epState.activeCardId);
  const activeVideoUrl = activeCard?.videoUrl;
  const modeBadge = epState.mode === "single" ? "单图模式" : epState.mode === "firstlast" ? "首帧 → 尾帧" : epState.mode === "batchRelay" ? "批量接力" : "多参考图";

  // ── 导出对话内容（LLM分析情绪版，音谷台词JSON格式，不含旁白） ──
  const handleExportDialogue = async () => {
    // 检查 LLM 配置
    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    try {
      // 1. 从项目设置中获取已知角色名
      const knownNames: string[] = [];
      try {
        const cstRaw = await kvLoad("feicai-consistency");
        if (cstRaw) {
          const cst = JSON.parse(cstRaw);
          if (cst.characters?.length > 0) {
            for (const c of cst.characters) {
              if (c.name) knownNames.push(c.name);
            }
          }
        }
      } catch { /* ignore */ }

      // 2. 获取节拍拆解内容
      const bbRes = await fetch(`/api/outputs/beat-breakdown.md`);
      if (!bbRes.ok) { toast("未找到节拍拆解文件，请先运行分镜流水线", "error"); return; }
      const bbData = await bbRes.json();
      const bbContent: string = bbData.content || "";
      if (!bbContent.trim()) { toast("节拍拆解内容为空", "error"); return; }

      // 3. 调用 LLM 分析对话情绪（分批处理，每批最多3000字）
      const BATCH_SIZE = 3000;

      // 优先使用用户自定义提示词（来自提示词编辑页）
      const { loadSystemPromptsAsync } = await import("../lib/consistency");
      const savedPrompts = await loadSystemPromptsAsync();
      const SYSTEM_PROMPT = (savedPrompts.dialogueEmotion && savedPrompts.dialogueEmotion.length > 50)
        ? savedPrompts.dialogueEmotion
        : (await import("../lib/defaultPrompts")).DIALOGUE_EMOTION_PROMPT;

      // 将节拍拆解按段落分批
      const batches: string[] = [];
      let current = "";
      for (const line of bbContent.split("\n")) {
        if ((current + line).length > BATCH_SIZE && current.trim()) {
          batches.push(current);
          current = line + "\n";
        } else {
          current += line + "\n";
        }
      }
      if (current.trim()) batches.push(current);

      toast(`LLM 分析中（共 ${batches.length} 批）...`, "info");

      const allResults: { role_name: string; text_content: string; emotion_name: string; strength_name: string }[] = [];
      const validEmotions = new Set(["高兴", "生气", "伤心", "害怕", "厌恶", "低落", "惊喜", "平静"]);
      const validStrengths = new Set(["微弱", "稍弱", "中等", "较强", "强烈"]);

      for (let i = 0; i < batches.length; i++) {
        toast(`LLM 分析第 ${i + 1}/${batches.length} 批...`, "info");

        const charHint = knownNames.length > 0
          ? `\n\n【已知角色列表（优先使用这些名字）】\n${knownNames.join("、")}`
          : "";

        const llmRes = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: llmSettings["llm-key"] || "",
            baseUrl: (llmSettings["llm-url"] || "").replace(/\/+$/, ""),
            model: llmSettings["llm-model"] || "gemini-2.5-pro",
            provider: llmSettings["llm-provider"] || "openAi",
            systemPrompt: SYSTEM_PROMPT,
            prompt: `请分析以下小说文本，提取所有角色台词并标注情绪和强度：${charHint}\n\n<novel_content>\n${batches[i]}\n</novel_content>`,
            maxTokens: 8192,
          }),
        });

        if (!llmRes.ok) {
          const err = await llmRes.json().catch(() => ({}));
          toast(`第 ${i + 1} 批 LLM 请求失败: ${err.error || llmRes.statusText}`, "error");
          continue;
        }

        const llmData = await llmRes.json();
        let rawText: string = llmData.content || llmData.text || llmData.choices?.[0]?.message?.content || "";

        // 去除 LLM 可能包裹的 markdown 代码块
        rawText = rawText.trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        try {
          const parsed = JSON.parse(rawText);
          if (Array.isArray(parsed)) {
            // 旁白角色名的所有可能变体（LLM 有时不遵守指令）
            const NARRATOR_VARIANTS = new Set([
              "旁白", "旁白者", "叙述", "叙述者", "旁述", "解说", "解说者",
              "n", "narrator", "narration", "narrative", "voice", "voiceover", "voice over",
            ]);
            for (const item of parsed) {
              // 跳过旁白 / 过滤无效情绪强度
              const roleLower = String(item.role_name || "").trim().toLowerCase();
              if (!roleLower || NARRATOR_VARIANTS.has(roleLower)) continue;
              if (!item.text_content || !item.text_content.trim()) continue;
              allResults.push({
                role_name: String(item.role_name).trim(),
                text_content: String(item.text_content).trim(),
                emotion_name: validEmotions.has(item.emotion_name) ? item.emotion_name : "平静",
                strength_name: validStrengths.has(item.strength_name) ? item.strength_name : "中等",
              });
            }
          }
        } catch (parseErr) {
          console.warn(`[ExportDialogue] 第 ${i + 1} 批 JSON 解析失败:`, parseErr, "\n原文:", rawText.slice(0, 300));
          toast(`第 ${i + 1} 批解析失败，已跳过`, "error");
        }
      }

      if (allResults.length === 0) { toast("LLM 未提取到任何台词，请检查分镜内容", "error"); return; }

      // 4. 自动下载 JSON 文件
      const output = JSON.stringify(allResults, null, 2);
      const blob = new Blob([output], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `小说原台词导出-${episode}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`已导出 ${allResults.length} 条台词（LLM情绪分析·音谷格式）`, "success");
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
  };

  // ── 导出智能分镜对话内容（LLM分析情绪版，音谷台词JSON格式） ──
  const handleExportSmartDialogue = async () => {
    // 检查 LLM 配置
    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    try {
      // 1. 收集智能分镜中文描述内容
      const allBeatsText: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const epId = `ep${String(i).padStart(2, "0")}`;
        const raw = await kvLoad(`feicai-smart-nine-prompts-${epId}`);
        if (!raw || typeof raw !== "string") continue;
        try {
          const data = JSON.parse(raw) as { episodeId: string; title: string; description?: string; beats: string[] };
          const header = `【${data.episodeId?.toUpperCase() || epId.toUpperCase()} · ${data.title || "未命名"}】`;
          allBeatsText.push(header);
          data.beats.forEach((beat, idx) => {
            allBeatsText.push(`格${idx + 1}：${beat}`);
          });
          allBeatsText.push(""); // 空行分隔
        } catch { /* skip malformed */ }
      }
      if (allBeatsText.length === 0) {
        toast("没有找到智能分镜数据，请先在分镜流水线中完成智能分析", "error");
        return;
      }
      const fullContent = allBeatsText.join("\n");

      // 2. 从项目设置中获取已知角色名
      const knownNames: string[] = [];
      try {
        const cstRaw = await kvLoad("feicai-consistency");
        if (cstRaw) {
          const cst = JSON.parse(cstRaw);
          if (cst.characters?.length > 0) {
            for (const c of cst.characters) { if (c.name) knownNames.push(c.name); }
          }
        }
      } catch { /* ignore */ }

      // 3. 调用 LLM 分析对话情绪（分批处理，每批最多3000字）
      const BATCH_SIZE = 3000;

      const { loadSystemPromptsAsync } = await import("../lib/consistency");
      const savedPrompts = await loadSystemPromptsAsync();
      const SYSTEM_PROMPT = (savedPrompts.dialogueEmotion && savedPrompts.dialogueEmotion.length > 50)
        ? savedPrompts.dialogueEmotion
        : (await import("../lib/defaultPrompts")).DIALOGUE_EMOTION_PROMPT;

      const batches: string[] = [];
      let current = "";
      for (const line of fullContent.split("\n")) {
        if ((current + line).length > BATCH_SIZE && current.trim()) {
          batches.push(current);
          current = line + "\n";
        } else {
          current += line + "\n";
        }
      }
      if (current.trim()) batches.push(current);

      toast(`LLM 分析中（共 ${batches.length} 批）...`, "info");

      const allResults: { role_name: string; text_content: string; emotion_name: string; strength_name: string }[] = [];
      const validEmotions = new Set(["高兴", "生气", "伤心", "害怕", "厌恶", "低落", "惊喜", "平静"]);
      const validStrengths = new Set(["微弱", "稍弱", "中等", "较强", "强烈"]);

      for (let i = 0; i < batches.length; i++) {
        toast(`LLM 分析第 ${i + 1}/${batches.length} 批...`, "info");

        const charHint = knownNames.length > 0
          ? `\n\n【已知角色列表（优先使用这些名字）】\n${knownNames.join("、")}`
          : "";

        const llmRes = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: llmSettings["llm-key"] || "",
            baseUrl: (llmSettings["llm-url"] || "").replace(/\/+$/, ""),
            model: llmSettings["llm-model"] || "gemini-2.5-pro",
            provider: llmSettings["llm-provider"] || "openAi",
            systemPrompt: SYSTEM_PROMPT,
            prompt: `请分析以下分镜描述文本，提取所有角色台词并标注情绪和强度：${charHint}\n\n<novel_content>\n${batches[i]}\n</novel_content>`,
            maxTokens: 8192,
          }),
        });

        if (!llmRes.ok) {
          const err = await llmRes.json().catch(() => ({}));
          toast(`第 ${i + 1} 批 LLM 请求失败: ${err.error || llmRes.statusText}`, "error");
          continue;
        }

        const llmData = await llmRes.json();
        let rawText: string = llmData.content || llmData.text || llmData.choices?.[0]?.message?.content || "";
        rawText = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

        try {
          const parsed = JSON.parse(rawText);
          if (Array.isArray(parsed)) {
            const NARRATOR_VARIANTS = new Set([
              "旁白", "旁白者", "叙述", "叙述者", "旁述", "解说", "解说者",
              "n", "narrator", "narration", "narrative", "voice", "voiceover", "voice over",
            ]);
            for (const item of parsed) {
              const roleLower = String(item.role_name || "").trim().toLowerCase();
              if (!roleLower || NARRATOR_VARIANTS.has(roleLower)) continue;
              if (!item.text_content || !item.text_content.trim()) continue;
              allResults.push({
                role_name: String(item.role_name).trim(),
                text_content: String(item.text_content).trim(),
                emotion_name: validEmotions.has(item.emotion_name) ? item.emotion_name : "平静",
                strength_name: validStrengths.has(item.strength_name) ? item.strength_name : "中等",
              });
            }
          }
        } catch (parseErr) {
          console.warn(`[ExportSmartDialogue] 第 ${i + 1} 批 JSON 解析失败:`, parseErr, "\n原文:", rawText.slice(0, 300));
          toast(`第 ${i + 1} 批解析失败，已跳过`, "error");
        }
      }

      if (allResults.length === 0) { toast("LLM 未提取到任何台词，请检查分镜内容", "error"); return; }

      // 4. 自动下载 JSON 文件
      const output = JSON.stringify(allResults, null, 2);
      const blob = new Blob([output], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `智能分镜台词导出.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`已导出 ${allResults.length} 条台词（LLM情绪分析·音谷格式）`, "success");
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
  };

  // ── 导出剪映草稿 ──
  const handleExportJianyingDraft = async () => {
    const readyCards = epState.videoCards.filter((c) => c.status === "ready" && c.videoUrl);
    if (readyCards.length === 0) { toast("没有可导出的视频，请先生成视频", "error"); return; }

    setJianyingModalOpen(true);
    setJianyingExporting(true);
    setJianyingResult(null);

    try {
      // 从 videoUrl 提取磁盘文件名（/api/local-file/videos/xxx.mp4 → xxx.mp4）
      const videos = readyCards.map((card) => {
        let filename = "";
        if (card.videoUrl?.includes("/api/local-file/videos/")) {
          filename = decodeURIComponent(card.videoUrl.split("/api/local-file/videos/")[1] || "");
        } else if (card.videoUrl?.includes("/api/local-file?")) {
          const params = new URLSearchParams(card.videoUrl.split("?")[1]);
          filename = params.get("key") || `${card.id}.mp4`;
        } else {
          // CDN URL — 用 card.id 作为文件名（理论上不会走到这里，因为视频已经本地化）
          filename = `${card.id}.mp4`;
        }
        return {
          filename,
          durationSec: 10, // 默认10秒，剪映会自动检测实际时长
          label: card.label,
        };
      });

      const draftName = `${BRAND_NAME}-${episode.toUpperCase()}-${new Date().toLocaleDateString("zh-CN").replace(/\//g, "")}`;

      const res = await fetch("/api/jianying-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftName, ratio: effectiveRatio, videos }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(`生成失败: ${err.error || res.statusText}`, "error");
        setJianyingExporting(false);
        return;
      }

      const result = await res.json();
      setJianyingResult(result);
      toast(`剪映草稿已生成（${result.videoCount} 个视频）`, "success");
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setJianyingExporting(false);
    }
  };

  // ── 查看视频提示词（新窗口） ──
  const viewVideoPrompt = () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const title = `${episode.toUpperCase()} 视频生成提示词`;
    const modeLabel = epState.mode === "single" ? "单图" : epState.mode === "firstlast" ? "首尾帧" : epState.mode === "batchRelay" ? "接力" : "多参考";
    const prompt = currentPrompt || "(未填写提示词)";

    // Collect input images — same logic as handleGenerateVideo
    const inputImages: { label: string; url: string }[] = [];
    let inputImageUrl = "";
    let endImageUrl = "";

    if (epState.mode === "single") {
      const src = sourceImages[epState.selectedGrid];
      if (src?.url) {
        inputImages.push({ label: `单图 · 组${epState.selectedBeat + 1}格${epState.selectedGrid + 1}`, url: src.url });
        inputImageUrl = src.url;
      }
    } else if (epState.mode === "firstlast") {
      if (epState.firstFrameUrl) {
        inputImages.push({ label: "首帧 (inputImage)", url: epState.firstFrameUrl });
        inputImageUrl = epState.firstFrameUrl;
      }
      if (epState.lastFrameUrl) {
        inputImages.push({ label: "尾帧 (endImage)", url: epState.lastFrameUrl });
        endImageUrl = epState.lastFrameUrl;
      }
    } else {
      const refs = epState.refImages.filter((r) => r.url);
      refs.forEach((r, i) => {
        inputImages.push({ label: r.label || `参考图${i + 1}`, url: r.url });
      });
      if (refs.length > 0) inputImageUrl = refs[0].url;
    }

    // Convert relative URLs to absolute for the popup window
    const origin = window.location.origin;
    const toAbsUrl = (u: string) => {
      if (!u) return u;
      if (u.startsWith("data:") || u.startsWith("http://") || u.startsWith("https://") || u.startsWith("blob:")) return u;
      return origin + (u.startsWith("/") ? u : "/" + u);
    };

    const imageCards = inputImages.map((img) => {
      const absUrl = toAbsUrl(img.url);
      const imgTag = absUrl && absUrl.length > 10
        ? `<img src="${absUrl}" alt="${esc(img.label)}" onclick="this.classList.toggle('expanded')" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-img" style="display:none">图片加载失败</div>`
        : `<div class="no-img">图片未加载</div>`;
      return `<div class="sheet-card">${imgTag}<div class="sheet-card-body"><span class="sheet-names">${esc(img.label)}</span></div></div>`;
    }).join("\n");

    // Build the body preview to match what handleGenerateVideo actually sends
    const bodyPreview: Record<string, unknown> = {
      model: selectedModel.model || selectedModel.name,
      baseUrl: selectedModel.url || "(未配置)",
      prompt: prompt.slice(0, 200) + (prompt.length > 200 ? "..." : ""),
      inputImage: inputImageUrl ? `(${inputImageUrl.startsWith("data:") ? "data URL" : inputImageUrl} · ${Math.round(inputImageUrl.length / 1024)}KB)` : "(空 — 未设置图片!)",
      duration: parseFloat(effectiveDuration),
      ratio: effectiveRatio,
      resolution: effectiveResolution,
      motionStrength: epState.motionStrength,
      mode: epState.mode,
      provider: selectedModel.provider || "third-party",
    };
    if (endImageUrl) bodyPreview.endImage = `(${endImageUrl.startsWith("data:") ? "data URL" : endImageUrl} · ${Math.round(endImageUrl.length / 1024)}KB)`;
    if (epState.mode === "multiref") {
      const refUrls = epState.refImages.filter(r => r.url).map(r => r.url);
      if (refUrls.length > 1) bodyPreview.referenceImages = `(${refUrls.length} 张参考图)`;
    }



    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; padding: 40px; max-width: 1200px; margin: 0 auto; line-height: 1.7; }
  h1 { color: #d4a853; font-size: 24px; border-bottom: 2px solid #d4a853; padding-bottom: 12px; }
  h2 { color: #d4a853; font-size: 18px; margin-top: 32px; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 13px; display: flex; flex-wrap: wrap; gap: 12px 24px; }
  .meta span { color: #888; }
  .meta b { color: #d4a853; }
  .prompt-box { background: #111; border: 1px solid #444; border-radius: 8px; padding: 20px; margin: 16px 0; white-space: pre-wrap; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; line-height: 1.8; }
  .section-tag { display: inline-block; background: #d4a853; color: #000; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
  .copy-btn { background: #d4a853; color: #000; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; margin-top: 12px; }
  .copy-btn:hover { background: #e0b860; }
  .char-count { color: #888; font-size: 12px; margin-top: 4px; }
  .sheet-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin: 16px 0; }
  .sheet-card { background: #141414; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
  .sheet-card:hover { border-color: #d4a853; }
  .sheet-card img { width: 100%; max-height: 300px; object-fit: contain; display: block; cursor: pointer; background: #0a0a0a; }
  .sheet-card img.expanded { max-height: none; }
  .sheet-card-body { padding: 10px 14px; border-top: 1px solid #333; }
  .sheet-names { font-size: 13px; font-weight: 600; color: #e0e0e0; }
  .no-img { width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; background: #1a1a1a; color: #555; font-size: 12px; }
  .body-pre { background: #111; border: 1px solid #333; border-radius: 8px; padding: 16px; font-family: 'Consolas', monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; color: #aaa; }
  .warn { background: #3a2a1a; border: 1px solid #d4a853; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #e0c070; font-size: 13px; }
</style></head><body>
<h1>${esc(title)}</h1>

<div class="meta">
  <div><span>模型: </span><b>${esc(selectedModel.model || selectedModel.name)}</b></div>
  <div><span>接口: </span><b>${esc(selectedModel.url || "(未配置)")}</b></div>
  <div><span>类型: </span><b>${selectedModel.provider === "official" ? "官方直连" : "第三方中转"}</b></div>
  <div><span>模式: </span><b>${esc(modeLabel)}</b></div>
  <div><span>时长: </span><b>${esc(effectiveDuration)}秒</b></div>
  <div><span>比例: </span><b>${esc(effectiveRatio)}</b></div>
  <div><span>分辨率: </span><b>${esc(effectiveResolution)}</b></div>
  <div><span>运动强度: </span><b>${epState.motionStrength}%</b></div>
</div>

<h2><span class="section-tag">PROMPT</span> 动态提示词</h2>
<div class="prompt-box">${esc(prompt)}</div>
<div class="char-count">${prompt.length} 字符</div>
<button class="copy-btn" onclick="navigator.clipboard.writeText(document.querySelector('.prompt-box').textContent).then(()=>this.textContent='已复制 ✓')">复制提示词</button>

<h2><span class="section-tag">IMAGES</span> 输入图片 (${inputImages.length} 张)</h2>
${inputImages.length > 0 ? `<div class="sheet-list">\n${imageCards}\n</div>` : `<div class="warn">⚠ 当前没有检测到输入图片。可能原因：<br/>· 页面热更新后图片状态丢失（data URL 不会持久化），请重新导入图片<br/>· 当前模式下未设置图片</div>`}

<h2><span class="section-tag">API</span> 请求体预览 (与实际发送一致)</h2>
<div class="body-pre">${esc(JSON.stringify(bodyPreview, null, 2))}</div>

</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };
  const existingImageKeys = new Set<string>();
  // 多参考模式使用 refImages 而非 sourceImages，导入选择应独立
  if (epState.mode !== "multiref") {
    sourceImages.forEach((img) => { if (img.url) existingImageKeys.add(img.key); });
  }

  if (!loaded) return null;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full w-full">
      <Sidebar />

      {/* ═══ LEFT PANEL ═══ */}
      <div className="flex flex-col w-[320px] shrink-0 bg-[var(--bg-page)] border-r border-[var(--border-default)] overflow-auto">
        {/* Left Header — 标题 + 保存/清除 */}
        <div className="flex items-center justify-between h-[52px] px-5 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-[var(--gold-primary)]" />
            <span className="font-serif text-[18px] font-medium text-[var(--text-primary)]">图生视频</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleSave} title="保存状态"
              className="flex items-center justify-center w-7 h-7 rounded border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer text-[var(--text-secondary)]">
              <Save size={13} />
            </button>
            <button onClick={handleClear} title="清除当前EP数据"
              className="flex items-center justify-center w-7 h-7 rounded border border-[var(--border-default)] hover:border-red-400 hover:text-red-400 transition cursor-pointer text-[var(--text-secondary)]">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* EP Selector — EP + 组 选择器 */}
        <div className="flex items-center justify-between h-9 px-5 border-b border-[var(--border-default)] shrink-0 bg-[var(--surface-contrast-strong)]">
          <button onClick={handleEpPrev} disabled={episodes.indexOf(episode) <= 0}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-30 disabled:cursor-default text-[var(--text-secondary)]">
            <ChevronLeft size={14} />
          </button>
          <div className="flex items-center gap-2">
            <select value={episode} onChange={(e) => handleEpChange(e.target.value)}
              className="bg-transparent text-[12px] font-medium text-[var(--gold-primary)] outline-none cursor-pointer text-center appearance-none">
              {episodes.map((ep) => <option key={ep} value={ep} className="bg-[var(--bg-card)]">{ep.toUpperCase()}</option>)}
            </select>
            <span className="text-[10px] text-[var(--text-muted)]">·</span>
            <select value={epState.selectedBeat} onChange={(e) => setEpState({ selectedBeat: Number(e.target.value) })}
              className="bg-transparent text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none">
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i} value={i} className="bg-[var(--bg-card)]">组{i + 1}</option>
              ))}
            </select>
          </div>
          <button onClick={handleEpNext} disabled={episodes.indexOf(episode) >= episodes.length - 1}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-30 disabled:cursor-default text-[var(--text-secondary)]">
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center h-10 border-b border-[var(--border-default)] shrink-0">
          {([
            { key: "single" as VideoMode, label: "单图" },
            { key: "firstlast" as VideoMode, label: "首尾帧" },
            { key: "multiref" as VideoMode, label: "多参考" },
            { key: "batchRelay" as VideoMode, label: "批量接力" },
          ]).map((tab) => (
            <button key={tab.key} onClick={() => setEpState({ mode: tab.key })}
              className={`flex-1 h-full text-[12px] cursor-pointer transition relative ${
                epState.mode === tab.key ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}>
              {tab.label}
              {epState.mode === tab.key && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-[var(--gold-primary)]" />}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 border-b border-[var(--border-default)]">
          <WorkflowHandoffChecklist checklist={videoHandoffChecklist} compact />
        </div>

        {videoRecoveryPanelItems.length > 0 && (
          <div className="px-4 py-3 border-b border-[var(--border-default)]">
            <WorkflowRecoveryPanel
              title="失败项恢复"
              description="这里会列出当前分集失败的视频卡片，你可以单独重试，或者先把失败项清掉再继续。"
              items={videoRecoveryPanelItems}
              onRetry={(id) => { void retryVideoFailure(id); }}
              onDismiss={dismissVideoFailure}
              onClearAll={clearAllVideoFailures}
              compact
            />
          </div>
        )}

        {/* ── Source Section ── */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          {epState.mode === "single" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">源图片 (来自四宫格)</span>
                <span className="text-[10px] text-[var(--gold-primary)] px-2 py-0.5 rounded bg-[#C9A96215] border border-[var(--gold-transparent)]">
                  {episode.toUpperCase()} · 组{epState.selectedBeat + 1}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {sourceImages.map((img, i) => (
                  <SourceThumb key={img.key} url={img.url} label={img.label}
                    isSelected={epState.selectedGrid === i} hasImage={!!img.url}
                    onClick={() => {
                      if (!img.url) {
                        setEpState({ selectedGrid: i });
                        openImportModal("single");
                      } else {
                        setEpState({ selectedGrid: i });
                      }
                    }}
                    onZoom={img.url ? () => setZoomUrl(img.url) : undefined}
                    onDelete={img.url ? () => {
                      const newSources = [...sourceImages];
                      newSources[i] = { ...newSources[i], url: "" };
                      setSourceImages(newSources);
                      deleteGridImageFromDisk(img.key);
                      if (epState.selectedGrid === i) setEpState({ selectedGrid: 0 });
                    } : undefined}
                  />
                ))}
              </div>
              {sourceImages[epState.selectedGrid]?.url ? (
                <div className="flex items-center gap-1.5">
                  <CircleCheckBig size={12} className="text-[var(--gold-primary)]" />
                  <span className="text-[11px] text-[var(--text-tertiary)]">已选择{sourceImages[epState.selectedGrid]?.label}作为输入图片</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => openImportModal("single")}
                    className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                    <Grid2X2 size={14} className="text-[var(--gold-primary)]" />
                    <span className="text-[11px] font-medium text-[var(--gold-primary)]">宫格导入</span>
                  </button>
                  <button onClick={() => { jimengLibraryTargetRef.current = "single"; setShowJimengLibrary(true); }}
                    className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                    <ImageIcon size={14} className="text-[var(--gold-primary)]" />
                    <span className="text-[11px] font-medium text-[var(--gold-primary)]">即梦图库</span>
                  </button>
                </div>
              )}
            </>
          )}

          <div className={`flex flex-col gap-2 mt-1 ${!isCurrentModelSora ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isCurrentModelSora ? "bg-purple-400" : "bg-gray-500"}`} />
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">Sora 素材库</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${isCurrentModelSora ? "text-purple-400/80 bg-purple-500/10 border-purple-500/20" : "text-gray-400/80 bg-gray-500/10 border-gray-500/20"}`}>仅Sora</span>
              </div>
              {selectedSoraCharIds.length > 0 && isCurrentModelSora && (
                <span className="text-[10px] text-purple-400">
                  已选 {selectedSoraCharIds.length} 个
                </span>
              )}
            </div>

            {!isCurrentModelSora ? (
              <div className="flex flex-col items-center gap-1.5 py-3 bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded">
                <span className="text-[10px] text-[var(--text-muted)]">当前模型不支持角色功能</span>
                <span className="text-[9px] text-[var(--text-muted)]">请在右侧面板选择 Sora 系列模型以使用角色一致性</span>
              </div>
            ) : (
              <>
                {selectedSoraCharIds.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {selectedSoraCharIds.map(id => {
                      const char = soraCharacters.find(c => c.id === id);
                      if (!char) return null;
                      const toneClass = char.category === "scene"
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : char.category === "prop"
                        ? "bg-amber-500/10 border border-amber-500/20"
                        : "bg-purple-500/10 border border-purple-500/20";
                      const badgeClass = char.category === "scene"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : char.category === "prop"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-purple-500/20 text-purple-400";
                      return (
                        <div key={id} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${toneClass}`}>
                          {char.profilePicture ? (
                            <img src={char.profilePicture} alt={char.username} className="w-10 h-10 rounded-md object-cover border border-purple-500/30 shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-[var(--surface-overlay)] flex items-center justify-center text-[14px] text-purple-300/60 border border-purple-500/20 shrink-0">
                              @
                            </div>
                          )}
                          <div className="flex flex-col flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-medium text-purple-300 truncate">
                                {char.nickname ? char.nickname : `@${char.username}`}
                              </span>
                              <span className={`text-[8px] px-1 py-px rounded ${badgeClass}`}>{SORA_CHAR_CATEGORY_LABEL[char.category || "character"]}</span>
                            </div>
                            <span className="text-[9px] text-[var(--text-muted)] truncate">@{char.username}</span>
                          </div>
                          <button onClick={() => toggleSoraChar(id)} className="text-[var(--text-muted)] hover:text-red-400 cursor-pointer p-1 shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button onClick={() => setSoraLibModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 w-full h-8 rounded bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition cursor-pointer">
                  <Plus size={12} className="text-purple-400" />
                  <span className="text-[10px] font-medium text-purple-400">
                    {soraCharacters.length > 0 ? `素材库 (${soraCharacters.length})` : "素材库"}
                  </span>
                </button>

                <SoraLibraryModal
                  open={soraLibModalOpen}
                  onClose={() => setSoraLibModalOpen(false)}
                  characters={soraCharacters}
                  selectedIds={selectedSoraCharIds}
                  onToggleSelect={toggleSoraChar}
                  onDelete={deleteSoraCharacter}
                  apiKey={selectedModel.apiKey || ""}
                  baseUrl={selectedModel.url?.replace(/\/+$/, "") || ""}
                  adapters={soraUploadAdapters}
                  smartMatchText={soraSmartMatchText}
                  smartMatchLabel={soraSmartMatchLabel}
                />

                <div className="flex items-start gap-1.5">
                  <Info size={10} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <span className="text-[9px] text-[var(--text-muted)] leading-relaxed">
                    选中的素材以 @username 注入提示词。可从已生成的Sora视频中提取。
                  </span>
                </div>
              </>
            )}
          </div>

          {epState.mode === "firstlast" && (
            <>
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">首帧 / 尾帧 图片</span>
              <div className="flex flex-col gap-3">
                {/* First frame */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold-primary)]" />
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">首帧 (必选)</span>
                  </div>
                  <div onClick={() => { if (!epState.firstFrameUrl) openImportModal("first"); }}
                    className={`relative flex items-center justify-center h-[100px] rounded cursor-pointer transition ${
                      epState.firstFrameUrl ? "ring-2 ring-[var(--gold-primary)] bg-[var(--surface-contrast)]" : "bg-[var(--surface-contrast)] border border-[var(--gold-primary)] border-dashed"
                    }`}>
                    {epState.firstFrameUrl ? (
                      <>
                        <img src={epState.firstFrameUrl} alt="首帧" className="w-full h-full object-contain bg-[var(--bg-card)] rounded" />
                        <button onClick={(e) => { e.stopPropagation(); setZoomUrl(epState.firstFrameUrl); }} className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded bg-[#0A0A0A80] cursor-pointer"><ZoomIn size={10} className="text-[var(--gold-primary)]" /></button>
                        <button onClick={(e) => { e.stopPropagation(); setEpState({ firstFrameUrl: "" }); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] cursor-pointer"><X size={10} className="text-[var(--text-secondary)]" /></button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1"><ImageIcon size={18} className="text-[var(--gold-primary)]" /><span className="text-[10px] text-[var(--gold-primary)]">点击选择首帧</span></div>
                    )}
                  </div>
                </div>
                {/* Last frame */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)]" />
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">尾帧 (可选)</span>
                  </div>
                  <div onClick={() => { if (!epState.lastFrameUrl) openImportModal("last"); }}
                    className={`relative flex items-center justify-center h-[100px] rounded cursor-pointer transition ${
                      epState.lastFrameUrl ? "ring-1 ring-[var(--border-default)] bg-[var(--surface-contrast)]" : "bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] border-dashed"
                    }`}>
                    {epState.lastFrameUrl ? (
                      <>
                        <img src={epState.lastFrameUrl} alt="尾帧" className="w-full h-full object-contain bg-[var(--bg-card)] rounded" />
                        <button onClick={(e) => { e.stopPropagation(); setZoomUrl(epState.lastFrameUrl); }} className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded bg-[#0A0A0A80] cursor-pointer"><ZoomIn size={10} className="text-[var(--text-secondary)]" /></button>
                        <button onClick={(e) => { e.stopPropagation(); setEpState({ lastFrameUrl: "" }); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] cursor-pointer"><X size={10} className="text-[var(--text-secondary)]" /></button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1"><Plus size={20} className="text-[var(--text-muted)]" /><span className="text-[10px] text-[var(--text-muted)]">点击选择尾帧或拖拽图片</span></div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => openImportModal(epState.firstFrameUrl ? "last" : "first")}
                    className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                    <Grid2X2 size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">宫格导入</span>
                  </button>
                  <button onClick={() => { jimengLibraryTargetRef.current = epState.firstFrameUrl ? "last" : "first"; setShowJimengLibrary(true); }}
                    className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                    <ImageIcon size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">即梦图库</span>
                  </button>
                </div>
                {epState.videoCards.some((c) => c.status === "ready" && c.videoUrl) && (
                  <div className="flex gap-2">
                    <button onClick={() => openFrameCapture("first")}
                      className="flex-1 flex items-center justify-center gap-2 h-9 rounded border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:bg-[#C9A96208] transition cursor-pointer">
                      <Scissors size={13} className="text-[var(--text-tertiary)]" /><span className="text-[10px] text-[var(--text-tertiary)]">截取视频帧→首帧</span>
                    </button>
                    <button onClick={() => openFrameCapture("last")}
                      className="flex-1 flex items-center justify-center gap-2 h-9 rounded border border-[var(--border-default)] hover:border-[var(--text-secondary)] hover:bg-[#ffffff05] transition cursor-pointer">
                      <Scissors size={13} className="text-[var(--text-muted)]" /><span className="text-[10px] text-[var(--text-muted)]">截取视频帧→尾帧</span>
                    </button>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <Info size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <span className="text-[10px] text-[var(--text-muted)] leading-relaxed">首尾帧模式：AI将生成从首帧到尾帧的过渡视频</span>
                </div>
              </div>
            </>
          )}

          {epState.mode === "multiref" && (
            <>
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">多参考图片</span>
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const ref = epState.refImages[i];
                    const labels = ["主体", "参考", "参考", "参考", "参考"];
                    return (
                      <SourceThumb key={i} url={ref?.url} label={`参考${i + 1}`}
                        isSelected={!!ref?.url} hasImage={!!ref?.url} gold={i === 0}
                        onClick={() => { if (!ref?.url) openImportModal("multiref"); }}
                        onZoom={ref?.url ? () => setZoomUrl(ref.url) : undefined}
                        onDelete={ref?.url ? () => {
                          const newRefs = [...epState.refImages]; newRefs.splice(i, 1);
                          setEpState({ refImages: newRefs });
                        } : undefined} />
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--text-muted)]">第1格=主体，其余=参考，最多5张</span>
                </div>
                <button onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*"; input.multiple = true;
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (!files || files.length === 0) return;
                    const fileArr = Array.from(files);
                    // Check file size limit (50MB)
                    const oversized = fileArr.find((f) => f.size > 50 * 1024 * 1024);
                    if (oversized) { toast(`文件 ${oversized.name} 超过 50MB 限制`, "error"); return; }
                    const newRefs: { url: string; label: string }[] = [];
                    let processed = 0;
                    fileArr.forEach((file) => {
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const dataUrl = reader.result as string;
                        // Save to IndexedDB to avoid localStorage quota
                        const uniqueId = `ref-ext-${episode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                        await saveOneGridImageToDisk(uniqueId, dataUrl);
                        newRefs.push({ url: dataUrl, label: file.name });
                        processed++;
                        if (processed === fileArr.length) {
                          setAllStates((prev) => {
                            const cur = prev[episode] || { ...defaultEpState };
                            return { ...prev, [episode]: { ...cur, refImages: [...cur.refImages, ...newRefs].slice(0, 5) } };
                          });
                          toast(`已添加 ${newRefs.length} 张外部参考图`, "success");
                        }
                      };
                      reader.readAsDataURL(file);
                    });
                  };
                  input.click();
                }} className="flex items-center justify-center gap-2 h-9 rounded border border-[var(--border-default)] hover:border-[var(--text-secondary)] transition cursor-pointer">
                  <Plus size={14} className="text-[var(--text-muted)]" /><span className="text-[11px] text-[var(--text-muted)]">添加外部参考图 (最多5张)</span>
                </button>
                <button onClick={() => openImportModal("multiref")}
                  className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                  <Grid2X2 size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">从宫格导入图片</span>
                </button>
                <button onClick={() => { jimengLibraryTargetRef.current = "multiref"; setShowJimengLibrary(true); }}
                  className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                  <ImageIcon size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">即梦图库</span>
                </button>
                <div className="flex items-start gap-1.5">
                  <Info size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <span className="text-[10px] text-[var(--text-muted)] leading-relaxed">多参考模式：多张图片共同引导视频风格和内容</span>
                </div>
              </div>
            </>
          )}

          {epState.mode === "batchRelay" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">接力源图片</span>
                <span className="text-[10px] text-[var(--gold-primary)] px-2 py-0.5 rounded bg-[#C9A96215] border border-[var(--gold-transparent)]">
                  {episode.toUpperCase()} · 组{epState.selectedBeat + 1}
                </span>
              </div>
              {/* 隐藏的文件上传 input */}
              <input ref={relayUploadRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const slotIdx = relayUploadSlotRef.current;
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result as string;
                  const newSources = [...sourceImages];
                  newSources[slotIdx] = { ...newSources[slotIdx], url: dataUrl };
                  setSourceImages(newSources);
                  saveOneGridImageToDisk(newSources[slotIdx].key, dataUrl);
                  toast(`已上传图片到格子 ${["A", "B", "C", "D"][slotIdx]}`, "success");
                };
                reader.readAsDataURL(file);
                e.target.value = "";
              }} />
              {/* ABCD 图片网格 — 2x2 全宽布局，点击上传，独立删除 */}
              <div className="grid grid-cols-4 gap-2">
                {sourceImages.map((img, i) => (
                  <div key={img.key} className="flex flex-col items-center gap-1"
                    draggable={!!img.url}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
                      if (isNaN(fromIdx) || fromIdx === i) return;
                      const newSources = [...sourceImages];
                      const temp = newSources[fromIdx];
                      newSources[fromIdx] = { ...newSources[i], key: newSources[fromIdx].key, label: newSources[fromIdx].label };
                      newSources[i] = { ...temp, key: newSources[i].key, label: newSources[i].label };
                      setSourceImages(newSources);
                      saveOneGridImageToDisk(newSources[fromIdx].key, newSources[fromIdx].url);
                      saveOneGridImageToDisk(newSources[i].key, newSources[i].url);
                    }}>
                    <div className={`group relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 transition ${
                      img.url
                        ? "border-[var(--gold-transparent)] cursor-grab active:cursor-grabbing hover:border-[var(--gold-primary)]"
                        : "border-[var(--border-default)] border-dashed cursor-pointer hover:border-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                    }`} onClick={() => {
                      if (!img.url) {
                        // 点击空格子 → 触发文件上传
                        relayUploadSlotRef.current = i;
                        relayUploadRef.current?.click();
                      }
                    }}>
                      {img.url ? (
                        <>
                          <img src={img.url} alt={["A", "B", "C", "D"][i]} draggable={false} className="w-full h-full object-cover" />
                          {/* 放大按钮 */}
                          <button onClick={(e) => { e.stopPropagation(); setZoomUrl(img.url); }}
                            className="absolute top-1 left-1 w-6 h-6 flex items-center justify-center rounded bg-[#0A0A0A80] hover:bg-[#0A0A0AA0] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                            <ZoomIn size={11} className="text-[var(--gold-primary)]" />
                          </button>
                          {/* 替换按钮 */}
                          <button onClick={(e) => {
                            e.stopPropagation();
                            relayUploadSlotRef.current = i;
                            relayUploadRef.current?.click();
                          }}
                            className="absolute bottom-1 left-1 w-6 h-6 flex items-center justify-center rounded bg-[#0A0A0A80] hover:bg-[#0A0A0AA0] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                            <RefreshCw size={10} className="text-[var(--gold-primary)]" />
                          </button>
                          {/* 删除按钮 */}
                          <button onClick={(e) => {
                            e.stopPropagation();
                            const newSources = [...sourceImages];
                            newSources[i] = { ...newSources[i], url: "" };
                            setSourceImages(newSources);
                            deleteGridImageFromDisk(img.key);
                          }}
                            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] hover:border-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={11} className="text-[var(--text-secondary)]" />
                          </button>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-[var(--surface-contrast)]">
                          <Plus size={18} className="text-[var(--text-muted)]" />
                          <span className="text-[9px] text-[var(--text-muted)]">点击上传</span>
                        </div>
                      )}
                    </div>
                    <span className={`text-[11px] font-semibold ${img.url ? "text-[var(--gold-primary)]" : "text-[var(--text-muted)]"}`}>
                      {["A", "B", "C", "D"][i]}
                    </span>
                  </div>
                ))}
              </div>
              {/* 图片就绪状态提示 */}
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-[var(--text-muted)]">
                  已上传 {sourceImages.filter((s) => s.url).length}/4 张
                </span>
                {!batchRelayAllReady && (
                  <span className="text-[10px] text-amber-400/80">请上传全部4张图片后生成视频</span>
                )}
              </div>
              {/* Relay pairs summary */}
              <div className="flex flex-col gap-1">
                {[
                  { label: "A→B", imgs: [0, 1], key: "ab" },
                  { label: "B→C", imgs: [1, 2], key: "bc" },
                  { label: "C→D", imgs: [2, 3], key: "cd" },
                ].map((pair) => (
                  <div key={pair.key} className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] cursor-pointer transition ${
                    batchRelayActiveTab === pair.key ? "bg-[#C9A96215] border border-[var(--gold-transparent)]" : "border border-transparent hover:bg-[var(--bg-hover)]"
                  }`} onClick={() => setEpState({ batchRelayActiveTab: pair.key as "ab" | "bc" | "cd" })}>
                    <Link2 size={10} className={batchRelayActiveTab === pair.key ? "text-[var(--gold-primary)]" : "text-[var(--text-muted)]"} />
                    <span className={batchRelayActiveTab === pair.key ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-tertiary)]"}>{pair.label}</span>
                    <span className="text-[var(--text-muted)]">
                      {sourceImages[pair.imgs[0]]?.url && sourceImages[pair.imgs[1]]?.url ? "✓ 就绪" : "○ 缺图"}
                    </span>
                  </div>
                ))}
              </div>
              {/* 从宫格导入 + 即梦图库按钮 + 说明 */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => openImportModal("single")}
                  className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                  <Grid2X2 size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">宫格导入</span>
                </button>
                <button onClick={() => { jimengLibraryTargetRef.current = "relay"; setShowJimengLibrary(true); }}
                  className="flex items-center justify-center gap-2 h-9 rounded bg-[#C9A96210] border border-[var(--gold-transparent)] hover:bg-[#C9A96220] transition cursor-pointer">
                  <ImageIcon size={14} className="text-[var(--gold-primary)]" /><span className="text-[11px] font-medium text-[var(--gold-primary)]">即梦图库</span>
                </button>
              </div>
              <div className="flex items-start gap-1.5">
                <Info size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                <span className="text-[10px] text-[var(--text-muted)] leading-relaxed">点击空格子直接上传图片，或从宫格/即梦图库导入。拖拽图片可调整顺序，删除不会影响其他格子。</span>
              </div>
            </>
          )}
        </div>

        {/* ── Prompt Section ── */}
        <div className="flex flex-col gap-2.5 px-5 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">分镜提示词
              <span className="text-[10px] text-[var(--text-muted)] ml-1.5">({
                epState.mode === "single" ? `单图 · 组${epState.selectedBeat + 1}格${epState.selectedGrid + 1}`
                : epState.mode === "firstlast" ? "首尾帧"
                : epState.mode === "batchRelay" ? `接力 · ${{ ab: "A+B", bc: "B+C", cd: "C+D" }[batchRelayActiveTab]}`
                : "多参考"
              })</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPromptPickerOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--gold-transparent)] hover:bg-[#C9A96210] transition cursor-pointer">
                <Sparkles size={10} className="text-[var(--gold-primary)]" />
                <span className="text-[10px] text-[var(--gold-primary)]">选择分镜</span>
              </button>
              <button onClick={() => setDialoguePickerOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--gold-transparent)] hover:bg-[#C9A96210] transition cursor-pointer">
                <MessageSquareText size={10} className="text-[var(--gold-primary)]" />
                <span className="text-[10px] text-[var(--gold-primary)]">台词导入</span>
              </button>
              <button onClick={handleOpenAIPromptModal}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--gold-transparent)] hover:bg-[#C9A96210] transition cursor-pointer">
                <Sparkles size={10} className="text-[var(--gold-primary)]" />
                <span className="text-[10px] text-[var(--gold-primary)]">{epState.mode === "batchRelay" ? "接力AI" : "AI 生成"}</span>
              </button>
            </div>
          </div>
          {epState.mode === "batchRelay" && (
            <div className="flex items-center gap-1">
              {(["ab", "bc", "cd"] as const).map((tab) => {
                const labels: Record<string, string> = { ab: "A+B", bc: "B+C", cd: "C+D" };
                const isActive = batchRelayActiveTab === tab;
                return (
                  <button key={tab} onClick={() => setEpState({ batchRelayActiveTab: tab })}
                    className={`flex-1 py-1.5 text-[11px] rounded transition cursor-pointer ${
                      isActive
                        ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                        : "bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)]"
                    }`}>
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
          )}
          <textarea value={currentPrompt} onChange={(e) => setCurrentPrompt(e.target.value)}
            placeholder={epState.mode === "single" ? "从四宫格自动同步场景描述，也可手动编辑..." : epState.mode === "batchRelay" ? `输入${({ ab: "A→B", bc: "B→C", cd: "C→D" } as Record<string, string>)[batchRelayActiveTab]}的接力过渡描述...` : "镜头缓慢推向战士的面部，光影逐渐变化，展现角色内心的觉醒..."}
            className="w-full h-[100px] bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded px-3 py-2.5 text-[11px] text-[var(--text-tertiary)] leading-relaxed resize-none outline-none focus:border-[var(--gold-primary)] transition placeholder:text-[var(--text-muted)]" />
          {currentBeatDialogues.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <MessageSquareText size={10} className="text-[var(--gold-primary)]" />
                <span className="text-[10px] font-medium text-[var(--text-secondary)]">已导入台词（{currentBeatDialogues.length}条）</span>
                <button onClick={handleClearDialogues}
                  className="ml-auto text-[9px] text-[var(--text-muted)] hover:text-red-400 transition cursor-pointer">
                  全部清除
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentBeatDialogues.map((dialogue, index) => (
                  editingDialogueIndex === index ? (
                    <span key={`${dialogue.role}-${dialogue.text}-${index}`} className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--surface-contrast)] border border-[var(--gold-primary)] rounded text-[10px]">
                      <input
                        autoFocus
                        value={editingDialogueRole}
                        onChange={(e) => setEditingDialogueRole(e.target.value)}
                        className="w-[50px] bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded px-1 py-0.5 text-[10px] text-[var(--gold-primary)] font-medium outline-none focus:border-[var(--gold-primary)]"
                        placeholder="角色"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditedDialogue();
                          if (e.key === "Escape") {
                            setEditingDialogueIndex(-1);
                            setEditingDialogueRole("");
                            setEditingDialogueText("");
                          }
                        }}
                      />
                      <input
                        value={editingDialogueText}
                        onChange={(e) => setEditingDialogueText(e.target.value)}
                        className="w-[160px] bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded px-1 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none focus:border-[var(--gold-primary)]"
                        placeholder="台词内容"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditedDialogue();
                          if (e.key === "Escape") {
                            setEditingDialogueIndex(-1);
                            setEditingDialogueRole("");
                            setEditingDialogueText("");
                          }
                        }}
                      />
                      <button onClick={saveEditedDialogue} className="shrink-0 text-[9px] text-green-400 hover:text-green-300 transition cursor-pointer">✓</button>
                      <button onClick={() => {
                        setEditingDialogueIndex(-1);
                        setEditingDialogueRole("");
                        setEditingDialogueText("");
                      }} className="shrink-0 text-[9px] text-[var(--text-muted)] hover:text-red-400 transition cursor-pointer">✗</button>
                    </span>
                  ) : (
                    <span
                      key={`${dialogue.role}-${dialogue.text}-${index}`}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--surface-contrast)] border border-[var(--border-subtle)] rounded text-[10px] text-[var(--text-tertiary)] max-w-[300px] cursor-pointer hover:border-[var(--gold-primary)] transition"
                      title={`点击编辑${[dialogue.emotion, dialogue.strength, dialogue.speed, dialogue.voiceQuality].filter(Boolean).length > 0 ? ` · ${[dialogue.emotion, dialogue.strength, dialogue.speed, dialogue.voiceQuality].filter(Boolean).join(" · ")}` : ""}`}
                      onClick={() => startEditingDialogue(index, dialogue)}
                    >
                      <span className="text-[var(--gold-primary)] font-medium shrink-0">{dialogue.role}</span>
                      {(dialogue.emotion || dialogue.speed || dialogue.voiceQuality) && (
                        <span className="text-[8px] text-[var(--text-muted)] shrink-0">{[dialogue.emotion, dialogue.speed, dialogue.voiceQuality].filter(Boolean).join("/")}</span>
                      )}
                      <span className="truncate">「{dialogue.text}」</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDialogue(index);
                        }}
                        className="shrink-0 ml-0.5 text-[var(--text-muted)] hover:text-red-400 transition cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
        {/* ── API / Model Section ── */}
        <div className="flex flex-col gap-2.5 px-5 py-3 border-b border-[var(--border-subtle)]">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">视频生成模型</span>
          {videoModels.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded">
              <span className="text-[11px] text-[var(--text-muted)]">未配置视频模型</span>
              <a href="/settings" className="text-[11px] text-[var(--gold-primary)] hover:underline">前往设置页添加模型 →</a>
            </div>
          ) : (
            <>
              {/* Model selector */}
              <div className="relative">
                <button onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="flex items-center gap-2.5 w-full h-9 px-3 bg-[var(--surface-contrast-strong)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] transition cursor-pointer">
                  <div className={`w-1.5 h-1.5 rounded-full ${selectedModel.modes.includes(epState.mode) ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-[12px] text-[var(--text-primary)] flex-1 text-left truncate">{selectedModel.name}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${selectedModel.provider === "third-party" ? "bg-blue-500/15 text-blue-400" : "bg-green-500/15 text-green-400"}`}>
                    {selectedModel.provider === "third-party" ? "中转" : "官方"}
                  </span>
                  <ChevronDown size={12} className="text-[var(--text-tertiary)]" />
                </button>
                {showModelDropdown && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowModelDropdown(false)} />
                    <div className="absolute top-10 left-0 right-0 z-40 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded shadow-[var(--theme-shadow-card)] max-h-[320px] overflow-auto">
                      {/* 支持当前模式的模型 */}
                      {availableModels.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider bg-[var(--surface-contrast-strong)]">支持当前模式</div>
                          {availableModels.map((m) => (
                            <button key={m.id} onClick={() => { setEpState({ modelId: m.id }); setShowModelDropdown(false); }}
                              className={`flex items-center gap-2.5 w-full px-3 py-2 hover:bg-[var(--bg-hover)] cursor-pointer transition ${m.id === epState.modelId ? "bg-[#C9A96210]" : ""}`}>
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                              <span className="text-[11px] text-[var(--text-primary)] flex-1 text-left">{m.name}</span>
                              <span className="text-[9px] text-[var(--text-muted)]">{m.modes.map(mm => mm === "single" ? "单图" : mm === "firstlast" ? "首尾帧" : mm === "batchRelay" ? "接力" : "多参考").join("/")}</span>
                              {m.id === epState.modelId && <Check size={12} className="text-[var(--gold-primary)]" />}
                            </button>
                          ))}
                        </>
                      )}
                      {/* 不支持当前模式的模型 */}
                      {videoModels.filter(m => !m.modes.includes(epState.mode)).length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wider bg-[var(--surface-contrast-strong)]">其他模型</div>
                          {videoModels.filter(m => !m.modes.includes(epState.mode)).map((m) => (
                            <button key={m.id} onClick={() => { setEpState({ modelId: m.id }); setShowModelDropdown(false); }}
                              className={`flex items-center gap-2.5 w-full px-3 py-2 hover:bg-[var(--bg-hover)] cursor-pointer transition opacity-60 ${m.id === epState.modelId ? "bg-[#C9A96210]" : ""}`}>
                              <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                              <span className="text-[11px] text-[var(--text-primary)] flex-1 text-left">{m.name}</span>
                              <span className="text-[9px] text-[var(--text-muted)]">{m.modes.map(mm => mm === "single" ? "单图" : mm === "firstlast" ? "首尾帧" : mm === "batchRelay" ? "接力" : "多参考").join("/")}</span>
                              {m.id === epState.modelId && <Check size={12} className="text-[var(--gold-primary)]" />}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Mode capability badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {(["single", "firstlast", "multiref", "batchRelay"] as VideoMode[]).map((m) => {
                  const supported = selectedModel.modes.includes(m);
                  const isCurrentMode = epState.mode === m;
                  const label = m === "single" ? "单图" : m === "firstlast" ? "首尾帧" : m === "batchRelay" ? "接力" : "多参考";
                  return (
                    <span key={m} className={`text-[10px] px-2 py-0.5 rounded border ${
                      !supported ? "text-[var(--text-muted)] border-[var(--border-default)] line-through opacity-50"
                        : isCurrentMode ? "text-[var(--gold-primary)] border-[var(--gold-transparent)]"
                        : "text-[var(--text-tertiary)] border-[var(--border-default)]"
                    }`}>
                      {label} {supported ? "✓" : "✗"}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Params Section ── */}
        <div className="flex flex-col gap-3 px-5 py-3 border-b border-[var(--border-subtle)]">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">视频参数</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-[var(--text-tertiary)]">时长</span>
              <div className="flex gap-1">
                <select value={epState.duration} onChange={(e) => setEpState({ duration: e.target.value, durationOverride: "" })} suppressHydrationWarning
                  className={`flex-1 min-w-0 h-8 bg-[var(--surface-contrast-strong)] border rounded px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] cursor-pointer appearance-none ${epState.durationOverride ? "border-[var(--border-default)] opacity-50" : "border-[var(--border-default)]"}`}>
                  {[3, 4, 5, 6, 8, 10, 15, 20].map((d) => <option key={d} value={String(d)}>{d}秒</option>)}
                </select>
                <input
                  type="text"
                  placeholder="自定义"
                  value={epState.durationOverride || ""}
                  onChange={(e) => setEpState({ durationOverride: e.target.value.replace(/[^\d.]/g, "") })}
                  className={`w-[52px] h-8 bg-[var(--surface-contrast-strong)] border rounded px-1.5 text-[11px] text-center outline-none ${epState.durationOverride ? "border-[var(--gold-primary)] text-[var(--gold-primary)]" : "border-[var(--border-default)] text-[var(--text-muted)]"}`}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-[var(--text-tertiary)]">比例</span>
              <div className="flex gap-1">
                <select value={epState.ratio} onChange={(e) => setEpState({ ratio: e.target.value, ratioOverride: "" })} suppressHydrationWarning
                  className={`flex-1 min-w-0 h-8 bg-[var(--surface-contrast-strong)] border rounded px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] cursor-pointer appearance-none ${epState.ratioOverride ? "border-[var(--border-default)] opacity-50" : "border-[var(--border-default)]"}`}>
                  {["16:9", "9:16", "1:1", "4:3", "3:4"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="自定义"
                  value={epState.ratioOverride || ""}
                  onChange={(e) => setEpState({ ratioOverride: e.target.value })}
                  className={`w-[52px] h-8 bg-[var(--surface-contrast-strong)] border rounded px-1.5 text-[11px] text-center outline-none ${epState.ratioOverride ? "border-[var(--gold-primary)] text-[var(--gold-primary)]" : "border-[var(--border-default)] text-[var(--text-muted)]"}`}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-[var(--text-tertiary)]">分辨率</span>
              <div className="flex gap-1">
                <select value={epState.resolution} onChange={(e) => setEpState({ resolution: e.target.value, resolutionOverride: "" })} suppressHydrationWarning
                  className={`flex-1 min-w-0 h-8 bg-[var(--surface-contrast-strong)] border rounded px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] cursor-pointer appearance-none ${epState.resolutionOverride ? "border-[var(--border-default)] opacity-50" : "border-[var(--border-default)]"}`}>
                  {["480p", "720p", "1080p", "4K"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="自定义"
                  value={epState.resolutionOverride || ""}
                  onChange={(e) => setEpState({ resolutionOverride: e.target.value })}
                  className={`w-[52px] h-8 bg-[var(--surface-contrast-strong)] border rounded px-1.5 text-[11px] text-center outline-none ${epState.resolutionOverride ? "border-[var(--gold-primary)] text-[var(--gold-primary)]" : "border-[var(--border-default)] text-[var(--text-muted)]"}`}
                />
              </div>
            </div>
          </div>
          {(epState.durationOverride || epState.ratioOverride || epState.resolutionOverride) && (
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[var(--gold-primary)]">✏️ 手动覆盖：{[
                epState.durationOverride && `时长=${epState.durationOverride}s`,
                epState.ratioOverride && `比例=${epState.ratioOverride}`,
                epState.resolutionOverride && `分辨率=${epState.resolutionOverride}`,
              ].filter(Boolean).join("、")}</span>
              <button
                onClick={() => setEpState({ durationOverride: "", ratioOverride: "", resolutionOverride: "" })}
                className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                清除
              </button>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-tertiary)]">运动强度</span>
              <span className="text-[10px] tabular-nums text-[var(--gold-primary)]">{epState.motionStrength}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={epState.motionStrength}
              onChange={(e) => setEpState({ motionStrength: Number(e.target.value) })}
              className="w-full h-1 rounded appearance-none cursor-pointer accent-[#C9A862] bg-[var(--surface-overlay)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#C9A862] [&::-webkit-slider-thumb]:shadow-md" />
            <div className="flex items-center justify-between text-[9px] text-[var(--text-muted)]">
              <span>静止</span>
              <span>适中</span>
              <span>剧烈</span>
            </div>
            <p className="text-[9px] text-[var(--text-muted)] leading-relaxed mt-0.5">
              控制视频画面的动态幅度。100% 表示完全遵循提示词的运动描述；降低数值会让画面更稳定、运动更柔和，适合静态场景或特写镜头。
            </p>
          </div>
        </div>
        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Action Buttons ── */}
        <div className="flex flex-col gap-2 px-5 py-4">
          {(() => {
            // 批量接力模式：4张图未齐时锁定按钮
            const relayLocked = epState.mode === "batchRelay" && !batchRelayAllReady;
            const btnLabel = generatingCount > 0
              ? `生成视频 (${generatingCount}个进行中)`
              : epState.mode === "batchRelay"
                ? relayLocked ? `生成视频 (需上传4张图片)` : "生成视频 (一次生成3个视频)"
                : "生成视频";
            return (
              <button onClick={handleGenerateVideo} disabled={relayLocked}
                className={`flex items-center justify-center gap-2 h-10 rounded transition ${
                  relayLocked
                    ? "bg-[#3A3A3A] opacity-50 cursor-not-allowed"
                    : "bg-[var(--gold-primary)] hover:brightness-110 cursor-pointer"
                }`}>
                <Play size={16} className={relayLocked ? "text-[#888]" : "text-[#0A0A0A]"} />
                <span className={`text-[13px] font-medium ${relayLocked ? "text-[#888]" : "text-[#0A0A0A]"}`}>{btnLabel}</span>
              </button>
            );
          })()}

        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex flex-col flex-1 bg-[var(--bg-page)] min-w-0">
        {/* Main Header */}
        <div className="flex items-center justify-between h-[52px] px-6 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-serif text-[20px] font-medium text-[var(--text-primary)]">视频预览</span>
            <span className="text-[11px] font-medium text-[var(--gold-primary)] bg-[#C9A96215] px-2.5 py-0.5 rounded">{modeBadge}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={handleExportSmartDialogue}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded"
              title="导出智能分镜台词（音谷JSON格式）">
              <BookOpen size={15} /> 智能分镜台词导出
            </button>
            <button onClick={handleExportDialogue}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded"
              title="导出节拍拆解中的人物对话内容">
              <MessageSquareText size={15} /> 小说原台词导出
            </button>
            <button onClick={viewVideoPrompt}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded"
              title="查看视频提示词">
              <FileText size={15} /> 查看提示词
            </button>
            <button onClick={handleExportJianyingDraft}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded"
              title="导出剪映草稿（含教程）">
              <Film size={15} /> 导出剪映草稿
            </button>
            <button onClick={() => setVideoLayout("single")} className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer transition ${videoLayout === "single" ? "bg-[#C9A96220] border border-[var(--gold-primary)]" : "border border-[var(--border-default)] hover:border-[var(--text-secondary)]"}`} title="单列视图"><Square size={17} className={videoLayout === "single" ? "text-[var(--gold-primary)]" : "text-[var(--text-tertiary)]"} /></button>
            <button onClick={() => setVideoLayout("grid")} className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer transition ${videoLayout === "grid" ? "bg-[#C9A96220] border border-[var(--gold-primary)]" : "border border-[var(--border-default)] hover:border-[var(--text-secondary)]"}`} title="网格视图"><Grid2X2 size={17} className={videoLayout === "grid" ? "text-[var(--gold-primary)]" : "text-[var(--text-tertiary)]"} /></button>
          </div>
        </div>

        {/* Video Preview Area */}
        {epState.mode === "batchRelay" ? (() => {
          // Batch Relay specific preview: find latest card for each pair
          const relayPairs: { key: "ab" | "bc" | "cd"; label: string; display: string }[] = [
            { key: "ab", label: "A→B", display: "组合 A → B" },
            { key: "bc", label: "B→C", display: "组合 B → C" },
            { key: "cd", label: "C→D", display: "组合 C → D" },
          ];
          const pairCards = relayPairs.map((p) => {
            const cards = epState.videoCards.filter((c) => c.label === p.label);
            return { ...p, card: cards.length > 0 ? cards[cards.length - 1] : null };
          });
          const activePairKey = batchRelayActiveTab;
          const activePair = pairCards.find((p) => p.key === activePairKey) || pairCards[0];
          const activePairVideoUrl = activePair?.card?.videoUrl;
          const activePairStatus = activePair?.card?.status;
          const readyCount = pairCards.filter((p) => p.card?.status === "ready").length;

          return (
            <div className="flex-1 flex flex-col bg-[var(--surface-elevated)] min-h-0 px-8 py-5 gap-4 overflow-y-auto">
              {/* Main Video Preview */}
              <div className="relative w-full max-w-[720px] mx-auto aspect-video bg-[var(--surface-contrast)] rounded-lg overflow-hidden border border-[var(--gold-primary)] shadow-[var(--theme-shadow-soft)]">
                {activePairVideoUrl && (
                  <video key={activePair.card!.id} ref={videoRef} src={activePairVideoUrl} className="w-full h-full object-contain" autoPlay
                    muted={isMuted}
                    onTimeUpdate={() => { const v = videoRef.current; if (v) { setCurrentTime(v.currentTime); setVideoDuration(v.duration || 0); } }}
                    onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
                )}
                {!activePairVideoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-[#C9A96230] border border-[#C9A96260] flex items-center justify-center">
                      <Play size={24} className="text-[var(--gold-primary)] ml-0.5" />
                    </div>
                  </div>
                )}
                {activePairVideoUrl && (
                  <div onClick={handlePlayPause}
                    className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-opacity ${isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"}`}>
                    <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition ${
                      isPlaying ? "bg-[#00000060] border-[#ffffff30]" : "bg-[#C9A96230] border-[#C9A96260]"
                    }`}>
                      {isPlaying ? <Pause size={22} className="text-[var(--text-primary)]" /> : <Play size={22} className="text-[var(--gold-primary)] ml-0.5" />}
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Label Bar */}
              <div className="flex items-center justify-between w-full max-w-[720px] mx-auto">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded bg-[var(--gold-primary)]" />
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{activePair.display}</span>
                </div>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {activePairStatus === "ready" ? "已完成" : activePairStatus === "generating" ? `生成中 ${activePair.card?.progress || 0}%` : activePairStatus === "error" ? "生成失败" : "等待生成"}
                </span>
              </div>

              {/* Playback Controls */}
              <div className="flex items-center justify-between w-full max-w-[720px] mx-auto h-9 px-2 bg-[var(--surface-contrast-strong)] rounded-md shadow-[var(--theme-shadow-soft)]">
                <div className="flex items-center gap-3">
                  <button onClick={handlePlayPause} className="cursor-pointer">
                    {isPlaying ? <Pause size={16} className="text-[var(--text-primary)]" /> : <Play size={16} className="text-[var(--text-primary)]" />}
                  </button>
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">{formatTime(currentTime)} / {formatTime(videoDuration || parseFloat(effectiveDuration))}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  {readyCount >= 2 && (
                    <button disabled={isMergingVideos} onClick={async () => {
                      // 按顺序合并所有已完成的接力视频为一个文件
                      const readyPairs = pairCards.filter((p) => p.card?.status === "ready" && p.card?.videoUrl);
                      if (readyPairs.length === 0) { toast("没有已完成的视频可合成", "error"); return; }
                      setIsMergingVideos(true);
                      toast(`正在合成 ${readyPairs.length} 段接力视频，请稍候...`, "info");
                      try {
                        // 1. 拉取所有视频 Blob
                        const videoBlobs: Blob[] = [];
                        for (const p of readyPairs) {
                          const res = await fetch(p.card!.videoUrl!);
                          videoBlobs.push(await res.blob());
                        }
                        // 2. 创建 Canvas 和隐藏 Video 元素
                        const canvas = document.createElement("canvas");
                        const ctx = canvas.getContext("2d")!;
                        const vid = document.createElement("video");
                        vid.playsInline = true; vid.muted = true;
                        // 获取视频尺寸
                        const firstUrl = URL.createObjectURL(videoBlobs[0]);
                        vid.src = firstUrl;
                        await new Promise<void>((r) => { vid.onloadedmetadata = () => r(); });
                        canvas.width = vid.videoWidth || 1280;
                        canvas.height = vid.videoHeight || 720;
                        URL.revokeObjectURL(firstUrl);

                        // 3. 创建 MediaRecorder 录制 Canvas
                        const fps = 30;
                        const canvasStream = canvas.captureStream(fps);
                        // 尝试检测是否有音轨，使用 AudioContext 合成
                        let audioCtx: AudioContext | null = null;
                        let audioDest: MediaStreamAudioDestinationNode | null = null;
                        try {
                          audioCtx = new AudioContext();
                          audioDest = audioCtx.createMediaStreamDestination();
                          audioDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
                        } catch { /* 无音频也可继续 */ }

                        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
                          ? "video/webm;codecs=vp9,opus"
                          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
                            ? "video/webm;codecs=vp8,opus" : "video/webm";
                        const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 10_000_000 });
                        const chunks: Blob[] = [];
                        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

                        recorder.start(100);

                        // 4. 依次播放每段视频并绘制到 Canvas
                        for (let i = 0; i < videoBlobs.length; i++) {
                          const blobUrl = URL.createObjectURL(videoBlobs[i]);
                          vid.src = blobUrl;
                          await new Promise<void>((r) => { vid.oncanplaythrough = () => r(); vid.load(); });

                          // 尝试连接音频
                          let audioSource: MediaElementAudioSourceNode | null = null;
                          if (audioCtx && audioDest) {
                            try {
                              audioSource = audioCtx.createMediaElementSource(vid);
                              audioSource.connect(audioDest);
                            } catch { /* 忽略重复连接 */ }
                          }

                          vid.currentTime = 0;
                          await vid.play();

                          await new Promise<void>((resolve) => {
                            let animId = 0;
                            const drawFrame = () => {
                              if (vid.ended || vid.paused) { resolve(); return; }
                              ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
                              animId = requestAnimationFrame(drawFrame);
                            };
                            vid.onended = () => { cancelAnimationFrame(animId); resolve(); };
                            drawFrame();
                          });

                          if (audioSource) { try { audioSource.disconnect(); } catch { /* ignore */ } }
                          URL.revokeObjectURL(blobUrl);
                        }

                        // 5. 停止录制并生成合并后的 Blob
                        recorder.stop();
                        await new Promise<void>((r) => { recorder.onstop = () => r(); });
                        if (audioCtx) { try { await audioCtx.close(); } catch { /* ignore */ } }

                        const mergedBlob = new Blob(chunks, { type: mimeType });
                        const ext = mimeType.includes("webm") ? "webm" : "mp4";
                        const dlUrl = URL.createObjectURL(mergedBlob);
                        const a = document.createElement("a");
                        a.href = dlUrl;
                        a.download = `${episode}_组${epState.selectedBeat + 1}_接力合成.${ext}`;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(dlUrl), 5000);
                        toast(`接力视频合成完成！已下载 ${readyPairs.length} 段合成视频`, "success");
                      } catch (err) {
                        console.error("[MergeVideo]", err);
                        toast(`视频合成失败: ${err instanceof Error ? err.message : "未知错误"}`, "error");
                      } finally {
                        setIsMergingVideos(false);
                      }
                    }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border transition ${
                        isMergingVideos
                          ? "bg-[#C9A96210] border-[#C9A96230] opacity-60 cursor-wait"
                          : "bg-[#C9A96220] border-[#C9A96250] hover:bg-[#C9A96230] cursor-pointer"
                      }`}>
                      {isMergingVideos ? <Loader size={11} className="animate-spin text-[var(--gold-primary)]" /> : <Download size={11} className="text-[var(--gold-primary)]" />}
                      <span className="text-[10px] font-medium text-[var(--gold-primary)]">{isMergingVideos ? "合成中..." : "合成下载"}</span>
                    </button>
                  )}
                  <button onClick={() => { if (activePairVideoUrl) { const a = document.createElement("a"); a.href = activePairVideoUrl; a.download = `${episode}_${activePair.label}.mp4`; a.click(); } }} className="cursor-pointer">
                    <Download size={14} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition" />
                  </button>
                  <button onClick={() => { setIsMuted((m) => { const next = !m; if (videoRef.current) videoRef.current.muted = next; return next; }); }} className="cursor-pointer">
                    {isMuted ? <VolumeX size={14} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition" /> : <Volume2 size={14} className="text-[var(--gold-primary)] hover:text-[var(--text-primary)] transition" />}
                  </button>
                </div>
              </div>

              {/* Thumbnail Row — 3 pair cards */}
              <div className="flex items-stretch gap-3 w-full max-w-[720px] mx-auto">
                {pairCards.map((p) => {
                  const isActive = p.key === activePairKey;
                  const card = p.card;
                  const hasThumb = card?.thumbnailUrl;
                  const pairStatus = card?.status;
                  return (
                    <div key={p.key} onClick={() => {
                      setEpState({ batchRelayActiveTab: p.key });
                      if (card) setEpState({ activeCardId: card.id, batchRelayActiveTab: p.key });
                    }}
                      className={`flex-1 flex flex-col rounded-md overflow-hidden border cursor-pointer transition ${
                        isActive ? "border-[var(--gold-primary)]" : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
                      }`}>
                      <div className="relative h-[110px] bg-[var(--surface-contrast)] flex items-center justify-center">
                        {hasThumb ? (
                          <img src={card!.thumbnailUrl!} alt={p.label} className="w-full h-full object-cover" />
                        ) : pairStatus === "generating" ? (
                          <Loader size={20} className="animate-spin text-[#C9A96250]" />
                        ) : (
                          <Play size={18} className="text-[var(--text-muted)]" />
                        )}
                        {pairStatus === "ready" && hasThumb && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-[#C9A96250] flex items-center justify-center">
                              <Play size={12} className="text-[var(--gold-primary)] ml-0.5" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between h-7 px-2 bg-[var(--surface-contrast-strong)]">
                        <span className={`text-[10px] font-medium ${isActive ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>{p.label}</span>
                        <span className={`text-[9px] ${pairStatus === "ready" ? "text-[var(--gold-primary)]" : pairStatus === "generating" ? "text-[var(--gold-primary)]" : pairStatus === "error" ? "text-red-400" : "text-[var(--text-muted)]"}`}>
                          {pairStatus === "ready" ? "完成" : pairStatus === "generating" ? `${card?.progress || 0}%` : pairStatus === "error" ? "失败" : "待生成"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Regenerate Buttons Row */}
              <div className="flex items-center gap-3 w-full max-w-[720px] mx-auto">
                {pairCards.map((p) => {
                  const card = p.card;
                  const pairStatus = card?.status;
                  const canRegenerate = pairStatus === "ready" || pairStatus === "error";
                  return (
                    <div key={`regen-${p.key}`} className="flex-1 flex justify-center">
                      {canRegenerate && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRegenerateSingleRelay(p.key); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--bg-hover)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:bg-[#C9A96215] transition cursor-pointer group"
                          title={`重新生成 ${p.label}`}
                        >
                          <RefreshCw size={11} className="text-[var(--text-muted)] group-hover:text-[var(--gold-primary)] transition" />
                          <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--gold-primary)] transition">重新生成</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : (
        /* ═══ 缩略图网格视图（单图/首尾帧/多参考） ═══ */
        <div className="flex-1 flex flex-col bg-[var(--surface-elevated)] min-h-0 overflow-y-auto">
          {(() => {
            const visibleCards = epState.videoCards.filter((c) => c.status !== "pending");
            if (visibleCards.length === 0) {
              return (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-[#C9A96215] border border-[#C9A96230] flex items-center justify-center">
                    <Play size={28} className="text-[var(--gold-primary)] ml-1 opacity-40" />
                  </div>
                  <span className="text-[12px] text-[var(--text-muted)]">点击「生成视频」后，视频缩略图将在此排列</span>
                </div>
              );
            }
            const gridCols = videoLayout === "single"
              ? "grid-cols-1 max-w-[720px] mx-auto"
              : visibleCards.length <= 2 ? "grid-cols-2" : visibleCards.length <= 4 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
            return (
              <div className={`grid ${gridCols} gap-3 p-4`}>
                {visibleCards.map((card) => {
                  const isActive = card.id === epState.activeCardId;
                  return (
                    <div key={card.id}
                      onClick={() => {
                        setEpState({ activeCardId: card.id });
                        if (card.status === "ready" && card.videoUrl) setPlayerModalCard(card);
                      }}
                      className={`relative group flex flex-col rounded-lg overflow-hidden border cursor-pointer transition hover:border-[var(--gold-primary)] ${
                        isActive ? "border-[var(--gold-primary)] ring-1 ring-[var(--gold-primary)]" : "border-[var(--border-default)]"
                      }`}>
                      {/* 缩略图 */}
                      <div className="relative aspect-video bg-[var(--surface-contrast)] flex items-center justify-center overflow-hidden">
                        {card.status === "ready" && card.thumbnailUrl ? (
                          <>
                            <img src={card.thumbnailUrl} alt={card.label} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                              <div className="w-14 h-14 rounded-full bg-[#C9A96250] border border-[#C9A96260] flex items-center justify-center backdrop-blur-sm">
                                <Play size={24} className="text-[var(--gold-primary)] ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : card.status === "ready" && card.videoUrl ? (
                          <>
                            <div className="w-full h-full bg-[var(--surface-contrast)]" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-14 h-14 rounded-full bg-[#C9A96230] border border-[#C9A96260] flex items-center justify-center">
                                <Play size={24} className="text-[var(--gold-primary)] ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : card.status === "generating" ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader size={24} className="animate-spin text-[#C9A96250]" />
                            <span className="text-[10px] text-[var(--gold-primary)]">{card.progress || 0}%</span>
                          </div>
                        ) : card.status === "error" ? (
                          <div className="flex flex-col items-center gap-1">
                            <X size={20} className="text-red-400" />
                            <span className="text-[10px] text-red-400/60">生成失败</span>
                          </div>
                        ) : (
                          <ImageIcon size={24} className="text-[var(--border-default)]" />
                        )}
                        {/* 删除按钮 */}
                        {timelineDeleteMode && card.status !== "generating" && (
                          <button onClick={(e) => {
                            e.stopPropagation();
                            setAllStates((prev) => {
                              const cur = prev[episode] || { ...defaultEpState };
                              const updated = cur.videoCards.filter((c) => c.id !== card.id);
                              const newActive = cur.activeCardId === card.id ? (updated.length > 0 ? updated[updated.length - 1].id : "") : cur.activeCardId;
                              return { ...prev, [episode]: { ...cur, videoCards: updated, activeCardId: newActive } };
                            });
                          }}
                            className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center transition cursor-pointer">
                            <X size={14} className="text-white" />
                          </button>
                        )}
                      </div>
                      {/* 底部信息栏 */}
                      <div className="flex items-center justify-between h-10 px-3 bg-[var(--surface-contrast-strong)]">
                        <span className={`text-[13px] font-medium ${isActive ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>{card.label}</span>
                        <span className={`text-[12px] ${
                          card.status === "ready" ? "text-[var(--gold-primary)]"
                          : card.status === "generating" ? "text-[var(--gold-primary)]"
                          : card.status === "error" ? "text-red-400" : "text-[var(--text-muted)]"
                        }`}>
                          {card.status === "ready" ? "就绪" : card.status === "generating" ? `生成中 ${card.progress || 0}%` : card.status === "error" ? "失败" : "未生成"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        )}

        {/* ═══ TIMELINE ═══ */}
        {epState.mode === "batchRelay" ? (
        <div className="flex flex-col gap-2.5 h-[120px] px-6 py-3 bg-[var(--bg-page)] border-t border-[var(--border-default)] shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">接力进度</span>
            <div className="flex items-center gap-3">
              <button onClick={async () => {
                const readyCards = epState.videoCards.filter((c) => c.status === "ready" && c.videoUrl);
                if (readyCards.length === 0) { toast("没有可导出的视频", "error"); return; }
                for (const card of readyCards) {
                  try {
                    const res = await fetch(card.videoUrl!);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = `${episode}_${card.label}.mp4`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    await new Promise((r) => setTimeout(r, 300));
                  } catch { toast(`导出 ${card.label} 失败`, "error"); }
                }
                toast(`已导出 ${readyCards.length} 个视频`, "success");
              }} className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border-default)] hover:border-[var(--text-secondary)] transition cursor-pointer">
                <Download size={12} className="text-[var(--text-tertiary)]" /><span className="text-[10px] text-[var(--text-tertiary)]">导出全部</span>
              </button>
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]"><GripVertical size={10} />{effectiveRatio}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {[
              { label: "A→B", pairLabel: "A→B" },
              { label: "B→C", pairLabel: "B→C" },
              { label: "C→D", pairLabel: "C→D" },
            ].map((p, idx) => {
              const cards = epState.videoCards.filter((c) => c.label === p.pairLabel);
              const card = cards.length > 0 ? cards[cards.length - 1] : null;
              const progress = card?.status === "ready" ? 100 : card?.status === "generating" ? (card?.progress || 0) : 0;
              return (
                <div key={p.label} className="flex-1 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">{p.label}</span>
                    <span className={`text-[9px] ${card?.status === "ready" ? "text-[var(--gold-primary)]" : card?.status === "generating" ? "text-[var(--gold-primary)]" : card?.status === "error" ? "text-red-400" : "text-[var(--text-muted)]"}`}>
                      {card?.status === "ready" ? "完成" : card?.status === "generating" ? `${progress}%` : card?.status === "error" ? "失败" : "待生成"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-[var(--surface-overlay)] overflow-hidden">
                    <div className={`h-full transition-all ${card?.status === "error" ? "bg-red-400" : "bg-[var(--gold-primary)]"}`} style={{ width: `${progress}%` }} />
                  </div>
                  {idx < 2 && <div className="hidden" />}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center">
            <span className="text-[10px] text-[var(--text-muted)]">3段视频将按顺序拼接</span>
          </div>
        </div>
        ) : (
        /* ═══ 缩略图工具栏（单图/首尾帧/多参考） ═══ */
        <div className="flex items-center justify-between h-[48px] px-6 bg-[var(--bg-page)] border-t border-[var(--border-default)] shrink-0">
          <span className="text-[13px] font-medium text-[var(--text-muted)]">
            {epState.videoCards.filter((c) => c.status === "ready").length} 个视频就绪 / 共 {epState.videoCards.filter((c) => c.status !== "pending").length} 个
          </span>
          <div className="flex items-center gap-3">
            <button onClick={async () => {
              const readyCards = epState.videoCards.filter((c) => c.status === "ready" && c.videoUrl);
              if (readyCards.length === 0) { toast("没有可导出的视频", "error"); return; }
              for (const card of readyCards) {
                try {
                  const res = await fetch(card.videoUrl!);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `${episode}_${card.label}.mp4`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                  await new Promise((r) => setTimeout(r, 300));
                } catch { toast(`导出 ${card.label} 失败`, "error"); }
              }
              toast(`已导出 ${readyCards.length} 个视频`, "success");
            }} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-default)] hover:border-[var(--text-secondary)] transition cursor-pointer">
              <Download size={14} className="text-[var(--text-tertiary)]" /><span className="text-[12px] text-[var(--text-tertiary)]">导出全部</span>
            </button>
            <button onClick={() => setTimelineDeleteMode((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border transition cursor-pointer ${timelineDeleteMode ? "border-red-500/60 bg-red-500/10" : "border-[var(--border-default)] hover:border-[var(--text-secondary)]"}`}>
              <Trash2 size={14} className={timelineDeleteMode ? "text-red-400" : "text-[var(--text-tertiary)]"} /><span className={`text-[12px] ${timelineDeleteMode ? "text-red-400" : "text-[var(--text-tertiary)]"}`}>{timelineDeleteMode ? "完成" : "删除"}</span>
            </button>
            <span className="flex items-center gap-1 text-[12px] text-[var(--text-tertiary)]"><GripVertical size={12} />{effectiveRatio}</span>
          </div>
        </div>
        )}
      </div>

      {/* ═══ MODALS ═══ */}
      <GridImportModal open={showImportModal} onClose={() => setShowImportModal(false)}
        onImport={handleImportImages} defaultEpisode={episode} defaultBeat={epState.selectedBeat}
        episodes={episodes} existingKeys={existingImageKeys} />
      <JimengLibraryModal isOpen={showJimengLibrary} onClose={() => setShowJimengLibrary(false)}
        title="即梦图库 · 选择图片" onSelect={async (dataUrl) => {
          setShowJimengLibrary(false);
          const target = jimengLibraryTargetRef.current;
          if (target === "multiref") {
            // 多参考模式：添加到 refImages
            setAllStates((prev) => {
              const cur = prev[episode] || { ...defaultEpState };
              return { ...prev, [episode]: { ...cur, refImages: [...cur.refImages, { url: dataUrl, label: "即梦" }].slice(0, 5) } };
            });
            toast("已从即梦图库添加参考图", "success");
          } else if (target === "relay") {
            // 批量接力：找到第一个空槽位填入
            const slotIdx = sourceImages.findIndex((s) => !s.url);
            if (slotIdx === -1) { toast("所有槽位已满，请先删除一张", "info"); return; }
            const newSources = [...sourceImages];
            newSources[slotIdx] = { ...newSources[slotIdx], url: dataUrl };
            setSourceImages(newSources);
            saveOneGridImageToDisk(newSources[slotIdx].key, dataUrl);
            toast(`已添加图片到格子 ${["A", "B", "C", "D"][slotIdx]}`, "success");
          } else if (target === "single") {
            // 单图模式：设为当前选中格子的图片
            const idx = epState.selectedGrid;
            const newSources = [...sourceImages];
            newSources[idx] = { ...newSources[idx], url: dataUrl };
            setSourceImages(newSources);
            saveOneGridImageToDisk(newSources[idx].key, dataUrl);
            toast(`已设置${sourceImages[idx]?.label || `格${idx + 1}`}的图片`, "success");
          } else if (target === "first") {
            // 首帧
            setEpState({ firstFrameUrl: dataUrl });
            toast("已从即梦图库设置首帧图片", "success");
          } else if (target === "last") {
            // 尾帧
            setEpState({ lastFrameUrl: dataUrl });
            toast("已从即梦图库设置尾帧图片", "success");
          }
        }} />
      {zoomUrl && <ImageZoomModal url={zoomUrl} onClose={() => setZoomUrl(null)} />}
      <VideoPlayerModal
        open={!!playerModalCard}
        onClose={() => setPlayerModalCard(null)}
        videoUrl={playerModalCard?.videoUrl || ""}
        title={playerModalCard?.label}
        onQuickRelay={handleQuickRelay}
        downloadName={playerModalCard ? `${episode}_${playerModalCard.label}.mp4` : undefined}
      />
      <JianyingExportModal
        open={jianyingModalOpen}
        onClose={() => setJianyingModalOpen(false)}
        result={jianyingResult}
        isExporting={jianyingExporting}
      />
      <VideoFrameCaptureModal
        open={showFrameCapture}
        onClose={() => setShowFrameCapture(false)}
        videoCards={epState.videoCards}
        onCapture={handleFrameCaptured}
      />
      <PromptPickerModal
        open={promptPickerOpen}
        onClose={() => setPromptPickerOpen(false)}
        onSelect={(prompt) => {
          if (epState.mode === "batchRelay") {
            // 批量接力模式：暂不自动填充（用户手动选择格子后可扩展）
            setCurrentPrompt(prompt);
          } else {
            setCurrentPrompt(prompt);
          }
        }}
        episode={episode}
        selectedBeat={epState.selectedBeat}
        episodes={episodes}
      />
      <DialoguePickerModal
        open={dialoguePickerOpen}
        onClose={() => setDialoguePickerOpen(false)}
        onSelect={(dialogues) => {
          handleImportDialogues(dialogues);
          setDialoguePickerOpen(false);
        }}
        episode={episode}
        selectedBeat={epState.selectedBeat}
        episodes={episodes}
      />
      <AIPromptGenerateModal
        open={aiPromptModalOpen}
        onClose={() => setAiPromptModalOpen(false)}
        onGenerate={handleRunAIPromptFromModal}
        videoModels={videoModels.map((item) => ({ id: item.id, name: item.name, model: item.model }))}
        currentModelId={epState.modelId}
        dialogues={currentBeatDialogues}
        modeLabel={epState.mode === "batchRelay" ? "批量接力" : epState.mode === "firstlast" ? "首尾帧" : "多参考"}
        generating={aiPromptGenerating}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}















