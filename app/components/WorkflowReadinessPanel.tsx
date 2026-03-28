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

const SETTINGS_STORAGE_KEY = "feicai-settings";
const VIDEO_MODELS_STORAGE_KEY = "feicai-video-models";
const GEMINI_TAB_SETTINGS_KEY = "feicai-gemini-tab-settings";
const SEEDANCE_SETTINGS_KEY = "feicai-seedance-settings";
const AGGREGATE_VIDEO_DOMAINS = ["t8star.cn", "geeknow.top", "closeai.icu", "qnaigc.com", "yunwu.ai"];

type ReadinessStatus = "ready" | "needs-config" | "needs-attention";
type ReadinessKind = "core" | "extension";
type ValidationState = "idle" | "checking" | "passed" | "failed";

interface VideoModelLike {
  name?: string;
  model?: string;
  url?: string;
  apiKey?: string;
  provider?: string;
}

interface GeminiBrowserStatus {
  reachable?: boolean;
  isLaunched?: boolean;
  isLoggedIn?: boolean;
  activeTabs?: number;
  error?: string;
}

interface ReadinessItem {
  id: "llm" | "image" | "video" | "outputs" | "gemini" | "seedance";
  label: string;
  detail: string;
  status: ReadinessStatus;
  kind: ReadinessKind;
  actionLabel: string;
  actionType: "route" | "gemini-start";
  href?: string;
}

interface ValidationSnapshot {
  state: ValidationState;
  message: string;
  checkedAt?: string;
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

function parseVideoModels(raw: string | null): VideoModelLike[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as VideoModelLike[]) : [];
  } catch {
    return [];
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

function validationBadgeClass(state: ValidationState) {
  if (state === "passed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  if (state === "failed") return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  if (state === "checking") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return "border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-muted)]";
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

function validationLabel(state: ValidationState) {
  if (state === "passed") return "验证通过";
  if (state === "failed") return "验证失败";
  if (state === "checking") return "验证中";
  return "未验证";
}

function formatCheckedAt(iso?: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function getConnectionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "未知";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    message.includes("超时") ||
    normalized.includes("fetch failed")
  ) {
    return "连接超时，请检查网络或 API 地址是否正确";
  }
  return `网络错误: ${message}`;
}

async function readErrorMessage(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 408 || res.status === 504) {
    return "连接超时，请检查网络或 API 地址是否正确";
  }
  return String(data.error || data.message || fallback);
}

function getEffectiveStatus(item: ReadinessItem, validation?: ValidationSnapshot): ReadinessStatus {
  if (validation?.state === "failed" && item.status === "ready") return "needs-attention";
  return item.status;
}

export default function WorkflowReadinessPanel({
  context = "dashboard",
}: WorkflowReadinessPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<ReadinessItem[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [startingGemini, setStartingGemini] = useState(false);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [validation, setValidation] = useState<Record<ReadinessItem["id"], ValidationSnapshot>>({
    llm: { state: "idle", message: "尚未执行真实验证" },
    image: { state: "idle", message: "尚未执行真实验证" },
    video: { state: "idle", message: "尚未执行真实验证" },
    outputs: { state: "idle", message: "尚未执行真实验证" },
    gemini: { state: "idle", message: "尚未执行真实验证" },
    seedance: { state: "idle", message: "尚未执行真实验证" },
  });

  const setValidationState = useCallback((id: ReadinessItem["id"], next: ValidationSnapshot) => {
    setValidation((prev) => ({ ...prev, [id]: next }));
  }, []);

  const loadReadiness = useCallback(async () => {
    setRefreshing(true);
    try {
      const settings = parseLocalSettings(SETTINGS_STORAGE_KEY);
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

      const videoModels = parseVideoModels(videoRaw);
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

  const displayItems = useMemo(() => {
    return items.map((item) => ({
      ...item,
      displayStatus: getEffectiveStatus(item, validation[item.id]),
      validation: validation[item.id],
    }));
  }, [items, validation]);

  const { coreReady, coreTotal, extensionReady, extensionTotal, firstBlockingItem } = useMemo(() => {
    const coreItems = displayItems.filter((item) => item.kind === "core");
    const extensionItems = displayItems.filter((item) => item.kind === "extension");
    return {
      coreReady: coreItems.filter((item) => item.displayStatus === "ready").length,
      coreTotal: coreItems.length,
      extensionReady: extensionItems.filter((item) => item.displayStatus === "ready").length,
      extensionTotal: extensionItems.length,
      firstBlockingItem: displayItems.find((item) => item.displayStatus !== "ready") || null,
    };
  }, [displayItems]);

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
      setValidationState("gemini", {
        state: "passed",
        message: "服务启动成功，可继续验证登录状态",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Gemini Tab 启动失败", "error");
      setValidationState("gemini", {
        state: "failed",
        message: error instanceof Error ? error.message : "Gemini Tab 启动失败",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setStartingGemini(false);
    }
  }, [loadReadiness, setValidationState, toast]);

  const runValidation = useCallback(async (id: ReadinessItem["id"]) => {
    setValidationState(id, {
      state: "checking",
      message: "正在执行轻量验证...",
      checkedAt: new Date().toISOString(),
    });

    try {
      if (id === "llm") {
        const settings = parseLocalSettings(SETTINGS_STORAGE_KEY);
        const apiKey = String(settings["llm-key"] || "").trim();
        const baseUrl = String(settings["llm-url"] || "").trim();
        const model = String(settings["llm-model"] || "").trim();
        const provider = String(settings["llm-provider"] || "openAi").trim();
        if (!apiKey || !baseUrl || !model) throw new Error("LLM 配置不完整，请先填写 Key / URL / 模型");
        const res = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, baseUrl, model, prompt: "回复OK", maxTokens: 10, provider }),
        });
        if (!res.ok) throw new Error(await readErrorMessage(res, "LLM 连接测试失败"));
        setValidationState(id, {
          state: "passed",
          message: `${model} 连通正常`,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      if (id === "image") {
        const settings = parseLocalSettings(SETTINGS_STORAGE_KEY);
        const apiKey = String(settings["img-key"] || "").trim();
        const baseUrl = String(settings["img-url"] || "").trim();
        const model = String(settings["img-model"] || "").trim();
        const format = String(settings["img-format"] || "gemini").trim();
        if (!apiKey || !baseUrl || !model) throw new Error("图像配置不完整，请先填写 Key / URL / 模型");
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            baseUrl,
            model,
            format,
            prompt: "test",
            testOnly: true,
          }),
        });
        if (!res.ok) throw new Error(await readErrorMessage(res, "图像连接测试失败"));
        const data = await res.json().catch(() => ({}));
        setValidationState(id, {
          state: "passed",
          message: `${model} 可访问${data.endpoint ? ` · ${data.endpoint}` : ""}`,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      if (id === "video") {
        const videoRaw = await kvLoad(VIDEO_MODELS_STORAGE_KEY);
        const validVideoModels = parseVideoModels(videoRaw).filter(isVideoModelReady);
        const targetModel = validVideoModels[0];
        if (!targetModel) throw new Error("还没有可验证的视频模型，请先在设置页添加");
        const res = await fetch("/api/video/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: targetModel.apiKey,
            baseUrl: targetModel.url,
            model: targetModel.model || targetModel.name || "",
            prompt: "test",
            inputImage: "",
            mode: "single",
            provider: targetModel.provider || "third-party",
            testOnly: true,
          }),
        });
        if (!res.ok) throw new Error(await readErrorMessage(res, "视频模型连接测试失败"));
        const data = await res.json().catch(() => ({}));
        setValidationState(id, {
          state: "passed",
          message: `${targetModel.name || targetModel.model || "视频模型"} 连通正常${data.endpoint ? ` · ${data.endpoint}` : ""}`,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      if (id === "outputs") {
        const current = await fetch("/api/config/path");
        if (!current.ok) throw new Error(await readErrorMessage(current, "读取输出路径失败"));
        const data = await current.json().catch(() => ({}));
        const baseOutputDir = String(data.baseOutputDir || "").trim();
        if (!baseOutputDir) throw new Error("当前没有可用的输出目录配置");
        const verify = await fetch("/api/config/path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseOutputDir }),
        });
        if (!verify.ok) throw new Error(await readErrorMessage(verify, "输出路径写入测试失败"));
        setValidationState(id, {
          state: "passed",
          message: `目录可写：${baseOutputDir}`,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      if (id === "gemini") {
        const gemini = parseLocalSettings(GEMINI_TAB_SETTINGS_KEY);
        const serviceUrl = String(gemini.serviceUrl || "http://localhost:3099").trim() || "http://localhost:3099";
        const res = await fetch("/api/gemini-tab?path=/api/browser", {
          headers: { "x-gemini-tab-url": serviceUrl },
        });
        const data = (await res.json().catch(() => ({}))) as GeminiBrowserStatus;
        if (!data.reachable) {
          throw new Error(String(data.error || `无法连接 Gemini Tab 服务（${serviceUrl}）`));
        }
        if (!data.isLoggedIn) {
          throw new Error("Gemini Tab 服务已启动，但浏览器尚未登录 Gemini");
        }
        setValidationState(id, {
          state: "passed",
          message: `服务在线，${Number(data.activeTabs || 0)} 个标签页活跃`,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      const seedance = parseLocalSettings(SEEDANCE_SETTINGS_KEY);
      const sessionId = String(seedance.sessionId || "").trim();
      const webId = String(seedance.webId || "").trim();
      const userId = String(seedance.userId || "").trim();
      if (!sessionId || !webId || !userId) {
        throw new Error("Seedance 凭证不完整，请先填写 Session / WebId / UserId");
      }
      const res = await fetch("/api/seedance/health");
      if (!res.ok) throw new Error(await readErrorMessage(res, "Seedance 服务检查失败"));
      setValidationState(id, {
        state: "passed",
        message: "接口在线，凭证已填写",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      setValidationState(id, {
        state: "failed",
        message: getConnectionErrorMessage(error),
        checkedAt: new Date().toISOString(),
      });
    }
  }, [setValidationState]);

  const handleVerifyAll = useCallback(async () => {
    setVerifyingAll(true);
    try {
      const order: ReadinessItem["id"][] = ["llm", "image", "video", "outputs", "gemini", "seedance"];
      for (const id of order) {
        await runValidation(id);
      }
      toast("验证完成，已更新各项真实状态", "success");
      await loadReadiness();
    } finally {
      setVerifyingAll(false);
    }
  }, [loadReadiness, runValidation, toast]);

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
          <span className="text-[11px] text-[var(--text-muted)]">
            验证会调用轻量测试接口，不会改动当前项目数据。
          </span>
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleVerifyAll()}
            disabled={refreshing || startingGemini || verifyingAll}
            className="flex items-center gap-2 px-3 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-50"
          >
            {(verifyingAll) ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {verifyingAll ? "验证中..." : "验证全部"}
          </button>
          <button
            type="button"
            onClick={() => void loadReadiness()}
            disabled={refreshing || startingGemini || verifyingAll}
            className="flex items-center gap-2 px-3 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
          >
            {(refreshing || startingGemini) ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {refreshing ? "检查中..." : "刷新检查"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-6 pb-6">
        {displayItems.map((item) => {
          const Icon = itemIcons[item.id];
          const actionBusy = startingGemini && item.id === "gemini" && item.actionType === "gemini-start";
          const validationBusy = item.validation?.state === "checking";
          return (
            <div
              key={item.id}
              className={`flex flex-col gap-4 p-4 border bg-[var(--bg-card)] shadow-[var(--theme-shadow-soft)] ${panelTone(item.displayStatus)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 border border-[var(--border-default)] bg-[var(--surface-overlay)]">
                    <Icon size={16} className="text-[var(--gold-primary)]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">{item.label}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 border w-fit ${badgeClass(item.displayStatus)}`}>
                        {statusLabel(item.displayStatus)}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 border w-fit ${validationBadgeClass(item.validation?.state || "idle")}`}>
                        {validationLabel(item.validation?.state || "idle")}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {item.kind === "core" ? "核心" : "扩展"}
                </span>
              </div>

              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={13}
                  className={item.displayStatus === "ready" ? "text-emerald-400" : item.displayStatus === "needs-attention" ? "text-sky-400" : "text-amber-400"}
                />
                <span className="text-[12px] leading-relaxed text-[var(--text-secondary)] break-all">
                  {item.detail}
                </span>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[11px] text-[var(--text-secondary)]">
                {validationBusy ? <Loader size={12} className="animate-spin text-sky-300 shrink-0" /> : <RefreshCw size={12} className="text-[var(--text-muted)] shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{item.validation?.message || "尚未执行真实验证"}</span>
                {item.validation?.checkedAt && (
                  <span className="shrink-0 text-[var(--text-muted)]">{formatCheckedAt(item.validation.checkedAt)}</span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {item.displayStatus === "ready" ? "可以直接进入该环节" : "建议先补齐或验证这一项"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runValidation(item.id)}
                    disabled={refreshing || startingGemini || verifyingAll || validationBusy}
                    className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
                  >
                    {validationBusy ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {validationBusy ? "验证中..." : "验证"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleItemAction(item)}
                    disabled={refreshing || verifyingAll || actionBusy}
                    className="flex items-center gap-1.5 px-3 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-50"
                  >
                    {actionBusy ? <Loader size={12} className="animate-spin" /> : <ChevronRight size={12} />}
                    {actionBusy ? "处理中..." : item.actionLabel}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
