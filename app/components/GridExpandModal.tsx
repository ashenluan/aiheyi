"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bot,
  Download,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader,
  Scissors,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";

import { useToast } from "./Toast";
import { loadConsistencyAsync, loadSystemPromptsAsync, type ConsistencyProfile } from "../lib/consistency";
import {
  GRID_EXPAND_TEMPLATES,
  buildCustomGridPushPayload,
  buildCustomScriptImportRequest,
  clampGridCount,
  type GridExpandEntityMatchSummary,
  parseGridPromptLines,
  splitTextIntoGridPrompts,
} from "../lib/gridExpansion";

interface SplitItem {
  index: number;
  key: string;
  url: string;
  width: number;
  height: number;
}

interface RecentItem {
  key: string;
  url: string;
}

interface EntityMatchHit {
  id: string;
  name: string;
  score: number;
  reason: string;
}

function readLlmSettings() {
  try {
    const raw = localStorage.getItem("feicai-settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      apiKey: String(parsed["llm-key"] || "").trim(),
      baseUrl: String(parsed["llm-url"] || "").trim(),
      model: String(parsed["llm-model"] || "").trim(),
      provider: String(parsed["llm-provider"] || "").trim(),
    };
  } catch {
    return { apiKey: "", baseUrl: "", model: "", provider: "" };
  }
}

export default function GridExpandModal() {
  const router = useRouter();
  const { toast } = useToast();
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [gridCount, setGridCount] = useState(25);
  const [scriptPrompts, setScriptPrompts] = useState<string[]>([]);
  const [rawAiOutput, setRawAiOutput] = useState("");
  const [building, setBuilding] = useState(false);
  const [localBuilding, setLocalBuilding] = useState(false);

  const [promptSeed, setPromptSeed] = useState("");
  const [expandedPrompt, setExpandedPrompt] = useState("");
  const [expandingPrompt, setExpandingPrompt] = useState(false);

  const [imageDataUrl, setImageDataUrl] = useState("");
  const [splitItems, setSplitItems] = useState<SplitItem[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [consistencyProfile, setConsistencyProfile] = useState<ConsistencyProfile | null>(null);
  const [entitySummary, setEntitySummary] = useState<GridExpandEntityMatchSummary>({
    characters: [],
    scenes: [],
    props: [],
  });
  const [matchingEntities, setMatchingEntities] = useState(false);
  const [entitySummaryHint, setEntitySummaryHint] = useState("");

  const safeCount = useMemo(() => clampGridCount(gridCount, 25), [gridCount]);
  const entityMatchText = useMemo(() => {
    if (scriptPrompts.length > 0) return scriptPrompts.join("\n");
    if (rawAiOutput.trim()) return rawAiOutput.trim();
    return sourceText.trim();
  }, [rawAiOutput, scriptPrompts, sourceText]);

  const refreshRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/grid-expand?list=1");
      if (!res.ok) return;
      const data = (await res.json()) as { items?: RecentItem[] };
      setRecentItems(Array.isArray(data.items) ? data.items.slice(0, 12) : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await loadConsistencyAsync();
        if (!cancelled) setConsistencyProfile(profile);
      } catch {
        if (!cancelled) setConsistencyProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runEntityMatch = useCallback(async () => {
    if (!consistencyProfile) return;
    const text = entityMatchText.trim();
    const hasCandidates =
      consistencyProfile.characters.length > 0 ||
      consistencyProfile.scenes.length > 0 ||
      consistencyProfile.props.length > 0;

    if (!hasCandidates) {
      setEntitySummary({ characters: [], scenes: [], props: [] });
      setEntitySummaryHint("当前工作台还没有可识别的角色、场景或道具。");
      return;
    }
    if (!text) {
      setEntitySummary({ characters: [], scenes: [], props: [] });
      setEntitySummaryHint("输入台词或拆分结果后，这里会自动识别命中的角色、场景和道具。");
      return;
    }

    setMatchingEntities(true);
    try {
      const res = await fetch("/api/entity-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          limit: 5,
          characters: consistencyProfile.characters.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
          scenes: consistencyProfile.scenes.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
          props: consistencyProfile.props.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        characters?: EntityMatchHit[];
        scenes?: EntityMatchHit[];
        props?: EntityMatchHit[];
      };
      if (!res.ok) {
        throw new Error(String(data.error || "实体识别失败"));
      }
      const nextSummary: GridExpandEntityMatchSummary = {
        characters: Array.isArray(data.characters) ? data.characters : [],
        scenes: Array.isArray(data.scenes) ? data.scenes : [],
        props: Array.isArray(data.props) ? data.props : [],
      };
      setEntitySummary(nextSummary);
      const total = nextSummary.characters.length + nextSummary.scenes.length + nextSummary.props.length;
      setEntitySummaryHint(
        total > 0
          ? `已识别 ${total} 项实体，可在推送到生图工作台前快速确认上下文是否一致。`
          : "当前文本还没有命中工作台里的已建档实体。",
      );
    } catch (error) {
      setEntitySummary({ characters: [], scenes: [], props: [] });
      setEntitySummaryHint(error instanceof Error ? error.message : "实体识别失败");
    } finally {
      setMatchingEntities(false);
    }
  }, [consistencyProfile, entityMatchText]);

  useEffect(() => {
    if (!consistencyProfile) return;
    const timer = window.setTimeout(() => {
      void runEntityMatch();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [consistencyProfile, runEntityMatch]);

  async function runAiImport() {
    const trimmed = sourceText.trim();
    if (!trimmed) {
      toast("请先输入台词或剧本文本", "error");
      return;
    }

    const settings = readLlmSettings();
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      toast("请先在设置页补齐 LLM 配置", "error");
      return;
    }

    setBuilding(true);
    try {
      const prompts = await loadSystemPromptsAsync();
      const systemPrompt = prompts.customScriptImport || "";
      const prompt = buildCustomScriptImportRequest(trimmed, safeCount, title);
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          provider: settings.provider || undefined,
          systemPrompt: systemPrompt || undefined,
          prompt,
          maxTokens: 4096,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(String(data?.error || "AI 导入失败"));
      }
      const content = String(data.content || "").trim();
      const parsed = parseGridPromptLines(content, safeCount);
      setRawAiOutput(content);
      setScriptPrompts(parsed);
      toast(`AI 已拆出 ${parsed.length} 格分镜`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 导入失败";
      toast(message, "error");
    } finally {
      setBuilding(false);
    }
  }

  function runLocalSplit() {
    const trimmed = sourceText.trim();
    if (!trimmed) {
      toast("请先输入台词或剧本文本", "error");
      return;
    }
    setLocalBuilding(true);
    try {
      const prompts = splitTextIntoGridPrompts(trimmed, safeCount);
      setRawAiOutput(prompts.map((item, index) => `${index + 1}. ${item}`).join("\n"));
      setScriptPrompts(prompts);
      toast(`已本地拆成 ${prompts.length} 格`, "success");
    } finally {
      setLocalBuilding(false);
    }
  }

  async function buildPromptPreview() {
    const trimmed = promptSeed.trim() || sourceText.trim();
    if (!trimmed) {
      toast("请先输入要扩展的文本", "error");
      return;
    }
    setExpandingPrompt(true);
    try {
      const prompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/grid-expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "build-prompt",
          title,
          sourceText: trimmed,
          gridCount: safeCount,
          customPrompt: prompts.gridExpandAgent || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || "构建失败"));
      setExpandedPrompt(String(data.prompt || ""));
      if (!scriptPrompts.length && Array.isArray(data.prompts)) {
        setScriptPrompts(data.prompts.map((item: unknown) => String(item || "")));
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "构建失败", "error");
    } finally {
      setExpandingPrompt(false);
    }
  }

  async function splitComposite() {
    if (!imageDataUrl) {
      toast("请先上传合成图", "error");
      return;
    }
    setSplitting(true);
    try {
      const res = await fetch("/api/grid-expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "split",
          image: imageDataUrl,
          gridCount: safeCount,
          stem: `grid-expand-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || "切图失败"));
      setSplitItems(Array.isArray(data.items) ? data.items : []);
      toast(`已切出 ${Array.isArray(data.items) ? data.items.length : 0} 格`, "success");
      refreshRecent();
    } catch (error) {
      toast(error instanceof Error ? error.message : "切图失败", "error");
    } finally {
      setSplitting(false);
    }
  }

  function pushToStudio() {
    if (!scriptPrompts.length) {
      toast("当前没有可推送的分镜提示词", "error");
      return;
    }
    const payload = buildCustomGridPushPayload(scriptPrompts, safeCount, "grid-expand", entitySummary);
    try {
      localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));
      toast(`已推送 ${scriptPrompts.length} 格到生图工作台`, "success");
      router.push("/studio");
    } catch {
      toast("推送失败，请稍后重试", "error");
    }
  }

  function onUploadFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      setImageDataUrl(value);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-5 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3">
          <LayoutGrid size={22} className="text-[var(--gold-primary)]" />
          <div>
            <h1 className="font-serif text-[24px] font-bold text-[var(--text-primary)]">宫格扩展工作台</h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-1">
              把台词、剧本或合成图快速转成 9 / 16 / 25 格自定义分镜，并一键推送到生图工作台。
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-6">
          <section className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[var(--gold-primary)]" />
                <div>
                  <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">AI 导入分格</h2>
                  <p className="text-[12px] text-[var(--text-muted)] mt-1">台词 / 剧本导入，直接拆成自定义宫格提示词。</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {GRID_EXPAND_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    onClick={() => setGridCount(template.gridCount)}
                    className={`px-3 py-1.5 text-[11px] border transition cursor-pointer ${
                      safeCount === template.gridCount
                        ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)] text-[var(--gold-primary)]"
                        : "border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)]"
                    }`}
                    title={template.description}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="可选：填写项目标题或段落标题"
                className="px-3 py-2 text-[13px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
              />
              <input
                value={String(safeCount)}
                onChange={(event) => setGridCount(Number(event.target.value) || 9)}
                placeholder="目标格数"
                className="px-3 py-2 text-[13px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
              />
            </div>

            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="粘贴台词、剧情段落或剧本内容。AI 会按镜头推进拆成固定格数。"
              className="w-full min-h-[220px] px-3 py-3 text-[13px] leading-6 border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={runAiImport}
                disabled={building}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-[var(--gold-primary)] text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              >
                {building ? <Loader size={14} className="animate-spin" /> : <Bot size={14} />}
                AI 导入分格
              </button>
              <button
                onClick={runLocalSplit}
                disabled={localBuilding}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
              >
                {localBuilding ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
                本地快速拆分
              </button>
              <button
                onClick={pushToStudio}
                disabled={scriptPrompts.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
              >
                <ArrowRight size={14} />
                推送到生图工作台
              </button>
            </div>

            <div className="border border-[var(--border-default)] bg-[var(--bg-base)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium text-[var(--text-secondary)]">智能命中实体</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">
                    会根据当前文本或拆分后的分镜，识别当前工作台里已存在的角色、场景和道具。
                  </div>
                </div>
                <button
                  onClick={() => { void runEntityMatch(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  {matchingEntities ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  刷新识别
                </button>
              </div>

              <div className="text-[11px] leading-6 text-[var(--text-muted)]">
                {matchingEntities ? "正在识别当前文本命中的实体..." : entitySummaryHint || "还没有可识别的文本。"}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {([
                  { key: "characters", label: "角色", items: entitySummary.characters, tone: "text-purple-300 border-purple-500/20 bg-purple-500/10" },
                  { key: "scenes", label: "场景", items: entitySummary.scenes, tone: "text-emerald-300 border-emerald-500/20 bg-emerald-500/10" },
                  { key: "props", label: "道具", items: entitySummary.props, tone: "text-amber-300 border-amber-500/20 bg-amber-500/10" },
                ] as const).map((section) => (
                  <div key={section.key} className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{section.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 border ${section.tone}`}>
                        {section.items.length} 项
                      </span>
                    </div>
                    {section.items.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {section.items.map((item) => (
                          <div key={item.id} className="border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">{item.name}</span>
                              <span className="text-[10px] text-[var(--gold-primary)] shrink-0">{Math.round(item.score * 100)}%</span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-1 leading-5">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--text-muted)]">暂无命中</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-[var(--border-default)] bg-[var(--bg-base)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">拆分结果</span>
                <span className="text-[11px] text-[var(--text-muted)]">目标 {safeCount} 格</span>
              </div>
              {scriptPrompts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {scriptPrompts.map((prompt, index) => (
                    <div key={`${index}-${prompt}`} className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-3">
                      <div className="text-[11px] font-medium text-[var(--gold-primary)] mb-2">格 {index + 1}</div>
                      <div className="text-[12px] leading-6 text-[var(--text-secondary)] whitespace-pre-wrap">{prompt}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[var(--text-muted)]">还没有拆分结果。你可以先走 AI 导入，也可以先本地快速拆分。</div>
              )}
              {rawAiOutput && (
                <details className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-3">
                  <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-secondary)]">查看原始输出</summary>
                  <pre className="mt-3 text-[11px] leading-6 whitespace-pre-wrap text-[var(--text-muted)]">{rawAiOutput}</pre>
                </details>
              )}
            </div>
          </section>

          <section className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wand2 size={16} className="text-[var(--gold-primary)]" />
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">提示词扩展器</h2>
                <p className="text-[12px] text-[var(--text-muted)] mt-1">查看当前 9 / 16 / 25 格拆镜任务的系统提示词结构。</p>
              </div>
            </div>
            <textarea
              value={promptSeed}
              onChange={(event) => setPromptSeed(event.target.value)}
              placeholder="输入一段镜头需求或剧本文本，生成宫格扩展提示词模板。"
              className="w-full min-h-[130px] px-3 py-3 text-[13px] leading-6 border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
            />
            <button
              onClick={buildPromptPreview}
              disabled={expandingPrompt}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50"
            >
              {expandingPrompt ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
              生成扩展提示词
            </button>
            <textarea
              value={expandedPrompt}
              onChange={(event) => setExpandedPrompt(event.target.value)}
              placeholder="这里会显示当前宫格扩展的系统提示词。"
              className="w-full min-h-[260px] px-3 py-3 text-[12px] leading-6 border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)]"
            />
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-6">
          <section className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Scissors size={16} className="text-[var(--gold-primary)]" />
                <div>
                  <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">合成图切格</h2>
                  <p className="text-[12px] text-[var(--text-muted)] mt-1">把一张 3×3 / 4×4 / 5×5 合成图拆成单格素材，方便回灌到工作台或即梦。</p>
                </div>
              </div>
              <button
                onClick={() => uploadRef.current?.click()}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              >
                <Upload size={14} />
                上传合成图
              </button>
            </div>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => onUploadFile(event.target.files?.[0] || null)}
            />

            {imageDataUrl ? (
              <div className="border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageDataUrl} alt="待切分合成图" className="w-full max-h-[360px] object-contain bg-black/5" />
              </div>
            ) : (
              <div className="border border-dashed border-[var(--border-default)] bg-[var(--bg-base)] min-h-[200px] flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                <ImageIcon size={26} />
                <span className="text-[12px]">上传一张 9 / 16 / 25 格合成图</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={splitComposite}
                disabled={!imageDataUrl || splitting}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-[var(--gold-primary)] text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              >
                {splitting ? <Loader size={14} className="animate-spin" /> : <Scissors size={14} />}
                开始切图
              </button>
              <span className="text-[11px] text-[var(--text-muted)]">当前按 {safeCount} 格处理</span>
            </div>

            {splitItems.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {splitItems.map((item) => (
                  <div key={item.key} className="border border-[var(--border-default)] bg-[var(--bg-base)] p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.key} className="w-full aspect-square object-cover bg-black/5" />
                    <div className="mt-2 text-[11px] text-[var(--text-secondary)]">格 {item.index + 1}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{item.width} × {item.height}</div>
                    <a
                      href={item.url}
                      download={item.key}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--gold-primary)] hover:brightness-110"
                    >
                      <Download size={12} />
                      下载
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border border-[var(--border-default)] bg-[var(--bg-panel)] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <LayoutGrid size={16} className="text-[var(--gold-primary)]" />
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">最近切图结果</h2>
                <p className="text-[12px] text-[var(--text-muted)] mt-1">这里展示 `outputs/grid-expand` 里的最新素材。</p>
              </div>
            </div>
            {recentItems.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {recentItems.map((item) => (
                  <a
                    key={item.key}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="border border-[var(--border-default)] bg-[var(--bg-base)] p-2 hover:border-[var(--gold-primary)] transition"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.key} className="w-full aspect-square object-cover bg-black/5" />
                    <div className="mt-2 text-[10px] text-[var(--text-muted)] truncate">{item.key}</div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-[var(--text-muted)]">还没有切图记录，上传一张合成图后这里会自动更新。</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
