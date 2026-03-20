"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  Clapperboard,
  FolderOpen,
  Image as ImageIcon,
  Loader,
  RefreshCw,
  Settings2,
  Sparkles,
  Video,
} from "lucide-react";
import { useToast } from "./Toast";
import { kvLoad } from "../lib/kvDB";

const VIDEO_MODELS_STORAGE_KEY = "feicai-video-models";
const GEMINI_TAB_SETTINGS_KEY = "feicai-gemini-tab-settings";
const SEEDANCE_SETTINGS_KEY = "feicai-seedance-settings";
const AGGREGATE_VIDEO_DOMAINS = ["t8star.cn", "geeknow.top", "closeai.icu", "qnaigc.com", "yunwu.ai"];

type ReadinessStatus = "ready" | "needs-config" | "needs-attention";
type ReadinessKind = "core" | "extension";

interface VideoModelLike {
  model?: string;
  url?: string;
  apiKey?: string;
}

interface GeminiBrowserStatus {
  reachable?: boolean;
  isLaunched?: boolean;
  isLoggedIn?: boolean;
  activeTabs?: number;
  error?: string;
}

interface ReadinessItem {
  id: string;
  label: string;
  detail: string;
  status: ReadinessStatus;
  kind: ReadinessKind;
  actionLabel: string;
  actionType: "route" | "gemini-start";
  href?: string;
}

interface WorkflowReadinessPanelProps {
  context?: "dashboard" | "pipeline";
}

function parseLocalSettings(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isVideoModelReady(model: VideoModelLike): boolean {
  const url = String(model.url || "").trim();
  const apiKey = String(model.apiKey || "").trim();
  const modelId = String(model.model || "").trim();
  if (!url || !apiKey) return false;
  if (modelId) return true;
  return AGGREGATE_VIDEO_DOMAINS.some((domain) => url.includes(domain));
}

function badgeClass(status: ReadinessStatus) {
  if (status === "ready") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  if (status === "needs-attention") return "border-sky-500/30 bg-sky-500/10 text-sky-400";
  return "border-amber-500/30 bg-amber-500/10 text-amber-400";
}

function panelTone(status: ReadinessStatus) {
  if (status === "ready") return "border-[var(--border-default)]";
  if (status === "needs-attention") return "border-sky-500/20";
  return "border-amber-500/20";
}

function statusLabel(status: ReadinessStatus) {
  if (status === "ready") return "已就绪";
  if (status === "needs-attention") return "待处理";
  return "待配置";
}

export default function WorkflowReadinessPanel({
  context = "dashboard",
}: WorkflowReadinessPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<ReadinessItem[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [startingGemini, setStartingGemini] = useState(false);

  const loadReadiness = useCallback(async () => {
    setRefreshing(true);
    try {
      const settings = parseLocalSettings("feicai-settings");
      const seedance = parseLocalSettings(SEEDANCE_SETTINGS_KEY);
      const gemini = parseLocalSettings(GEMINI_TAB_SETTINGS_KEY);
      const serviceUrl = String(gemini.serviceUrl || "http://localhost:3099").trim() || "http://localhost:3099";

      const [videoRaw, pathResult, geminiResult] = await Promise.all([
        kvLoad(VIDEO_MODELS_STORAGE_KEY),
        fetch("/api/config/path")
          .then(async (res) => ({
            ok: res.ok,
            data: (await res.json().catch(() => ({}))) as Record<string, unknown>,
          }))
          .catch(() => ({ ok: false, data: {} as Record<string, unknown> })),
        fetch("/api/gemini-tab?path=/api/browser", {
          headers: { "x-gemini-tab-url": serviceUrl },
        })
          .then(async (res) => ({
            ok: res.ok,
            data: (await res.json().catch(() => ({}))) as GeminiBrowserStatus,
          }))
          .catch(() => ({ ok: false, data: {} as GeminiBrowserStatus })),
      ]);

      let videoModels: VideoModelLike[] = [];
      try {
        const parsed = videoRaw ? JSON.parse(videoRaw) : [];
        if (Array.isArray(parsed)) videoModels = parsed as VideoModelLike[];
      } catch {
        videoModels = [];
      }

      const validVideoModels = videoModels.filter(isVideoModelReady);
      const llmKey = String(settings["llm-key"] || "").trim();
      const llmModel = String(settings["llm-model"] || "").trim();
      const imgKey = String(settings["img-key"] || "").trim();
      const imgModel = String(settings["img-model"] || "").trim();
      const outputPath = String(pathResult.data.baseOutputDir || pathResult.data.defaultBase || "").trim();
      const seedanceReady = Boolean(seedance.sessionId && seedance.webId && seedance.userId);
      const geminiData = geminiResult.data || {};
      const geminiReachable = Boolean(geminiData.reachable);
      const geminiLoggedIn = Boolean(geminiData.isLoggedIn);
      const geminiTabs = Number(geminiData.activeTabs || 0);

      const nextItems: ReadinessItem[] = [
        {
          id: "llm",
          label: "LLM 配置",
          detail: llmKey ? `已配置 ${llmModel || "LLM 模型"}` : "缺少 LLM API Key，流水线和智能功能无法运行",
          status: llmKey ? "ready" : "needs-config",
          kind: "core",
          actionLabel: llmKey ? "前往设置" : "去配置",
          actionType: "route",
          href: "/settings",
        },
        {
          id: "image",
          label: "图像生成",
          detail: imgKey ? `已配置 ${imgModel || "图像模型"}` : "缺少图像 API Key，生图工作台无法出图",
          status: imgKey ? "ready" : "needs-config",
          kind: "core",
          actionLabel: imgKey ? "前往设置" : "去配置",
          actionType: "route",
          href: "/settings",
        },
        {
          id: "video",
          label: "视频模型",
          detail: validVideoModels.length > 0
            ? `已配置 ${validVideoModels.length} 个可用视频模型`
            : "还没有可直接使用的视频模型",
          status: validVideoModels.length > 0 ? "ready" : "needs-config",
          kind: "core",
          actionLabel: validVideoModels.length > 0 ? "查看配置" : "去添加",
          actionType: "route",
          href: "/settings",
        },
        {
          id: "outputs",
          label: "文件输出路径",
          detail: outputPath || "暂未读取到输出目录配置",
          status: pathResult.ok && outputPath ? "ready" : "needs-attention",
          kind: "core",
          actionLabel: "查看路径",
          actionType: "route",
          href: "/settings",
        },
        {
          id: "gemini",
          label: "Gemini Tab",
          detail: geminiReachable
            ? (geminiLoggedIn ? `服务在线 · 已登录 · ${geminiTabs} 个标签页活跃` : "服务在线，但浏览器尚未登录 Gemini")
            : (geminiData.error || `服务未连接（${serviceUrl}）`),
          status: geminiReachable ? (geminiLoggedIn ? "ready" : "needs-attention") : "needs-attention",
          kind: "extension",
          actionLabel: geminiReachable ? "前往 Gemini Tab" : "启动服务",
          actionType: geminiReachable ? "route" : "gemini-start",
          href: "/gemini-tab",
        },
        {
          id: "seedance",
          label: "Seedance 凭证",
          detail: seedanceReady ? "Session / WebId / UserId 已填写" : "缺少 Seedance 凭证，无法走即梦/Seedance 链路",
          status: seedanceReady ? "ready" : "needs-config",
          kind: "extension",
          actionLabel: seedanceReady ? "前往 Seedance" : "去配置",
          actionType: "route",
          href: "/seedance",
        },
      ];

      setItems(nextItems);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadReadiness();
    const rerun = () => void loadReadiness();
    window.addEventListener("focus", rerun);
    window.addEventListener("storage", rerun);
    return () => {
      window.removeEventListener("focus", rerun);
      window.removeEventListener("storage", rerun);
    };
  }, [loadReadiness]);

  const { coreReady, coreTotal, extensionReady, extensionTotal, firstBlockingItem } = useMemo(() => {
    const coreItems = items.filter((item) => item.kind === "core");
    const extensionItems = items.filter((item) => item.kind === "extension");
    return {
      coreReady: coreItems.filter((item) => item.status === "ready").length,
      coreTotal: coreItems.length,
      extensionReady: extensionItems.filter((item) => item.status === "ready").length,
      extensionTotal: extensionItems.length,
      firstBlockingItem: items.find((item) => item.status !== "ready") || null,
    };
  }, [items]);

  const handleGeminiStart = useCallback(async () => {
    setStartingGemini(true);
    try {
      const gemini = parseLocalSettings(GEMINI_TAB_SETTINGS_KEY);
      const serviceUrl = String(gemini.serviceUrl || "http://localhost:3099").trim() || "http://localhost:3099";
      const res = await fetch("/api/gemini-tab/start-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(String(data.error || "Gemini Tab 启动失败"));
      }
      toast(String(data.message || "Gemini Tab 服务已启动"), "success");
      await loadReadiness();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Gemini Tab 启动失败", "error");
    } finally {
      setStartingGemini(false);
    }
  }, [loadReadiness, toast]);

  const handleItemAction = useCallback(async (item: ReadinessItem) => {
    if (item.actionType === "route" && item.href) {
      router.push(item.href);
      return;
    }
    if (item.actionType === "gemini-start") {
      await handleGeminiStart();
    }
  }, [handleGeminiStart, router]);

  const title = context === "pipeline" ? "开始前检查" : "工作流就绪检查";
  const subtitle = context === "pipeline"
    ? "先确认关键能力已就绪，再启动整条分镜链路。"
    : "先把核心链路配齐，再进入流水线、Studio 和视频工作台会更顺。";

  const itemIcons = {
    llm: Sparkles,
    image: ImageIcon,
    video: Video,
    outputs: FolderOpen,
    gemini: Bot,
    seedance: Clapperboard,
  } as const;

  return (
    <section className="flex flex-col gap-5 w-full border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--theme-shadow-card)]">
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[var(--border-default)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-[var(--gold-primary)]" />
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</span>
          </div>
          <span className="text-[12px] text-[var(--text-secondary)]">{subtitle}</span>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-[11px] px-2 py-1 border border-[var(--border-default)] text-[var(--text-secondary)] bg-[var(--surface-overlay)]">
              核心链路 {coreReady}/{coreTotal}
            </span>
            <span className="text-[11px] px-2 py-1 border border-[var(--border-default)] text-[var(--text-secondary)] bg-[var(--surface-overlay)]">
              扩展链路 {extensionReady}/{extensionTotal}
            </span>
            {firstBlockingItem && (
              <span className="text-[11px] px-2 py-1 border border-amber-500/25 text-amber-300 bg-amber-500/8">
                当前优先补齐：{firstBlockingItem.label}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadReadiness()}
          disabled={refreshing || startingGemini}
          className="flex items-center gap-2 px-3 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
        >
          {(refreshing || startingGemini) ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {refreshing ? "检查中..." : "刷新检查"}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-6 pb-6">
        {items.map((item) => {
          const Icon = itemIcons[item.id as keyof typeof itemIcons];
          const actionBusy = startingGemini && item.id === "gemini" && item.actionType === "gemini-start";
          return (
            <div
              key={item.id}
              className={`flex flex-col gap-4 p-4 border bg-[var(--bg-card)] shadow-[var(--theme-shadow-soft)] ${panelTone(item.status)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 border border-[var(--border-default)] bg-[var(--surface-overlay)]">
                    <Icon size={16} className="text-[var(--gold-primary)]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">{item.label}</span>
                    <span className={`text-[10px] px-2 py-0.5 border w-fit ${badgeClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </div>
                {item.kind === "core" ? (
                  <span className="text-[10px] text-[var(--text-muted)]">核心</span>
                ) : (
                  <span className="text-[10px] text-[var(--text-muted)]">扩展</span>
                )}
              </div>

              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={13}
                  className={item.status === "ready" ? "text-emerald-400" : item.status === "needs-attention" ? "text-sky-400" : "text-amber-400"}
                />
                <span className="text-[12px] leading-relaxed text-[var(--text-secondary)] break-all">
                  {item.detail}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {item.status === "ready" ? "可以直接进入该环节" : "建议先补齐这一项"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleItemAction(item)}
                  disabled={refreshing || actionBusy}
                  className="flex items-center gap-1.5 px-3 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-50"
                >
                  {actionBusy ? <Loader size={12} className="animate-spin" /> : <ChevronRight size={12} />}
                  {actionBusy ? "处理中..." : item.actionLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
