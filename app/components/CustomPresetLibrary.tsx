"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Image,
  Layers3,
  Loader,
  Save,
  Trash2,
  Video,
  Zap,
} from "lucide-react";

export interface CustomPresetRecord {
  id: string;
  type: "llm" | "image" | "video" | "prompt" | "other";
  label: string;
  payload: Record<string, unknown>;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

interface CustomPresetLibraryProps {
  onApplyPreset: (preset: CustomPresetRecord) => Promise<void> | void;
  buildPayloads: {
    llm: () => Record<string, unknown>;
    image: () => Record<string, unknown>;
    video: () => Record<string, unknown>;
  };
  notify: (message: string, type: "success" | "error" | "info") => void;
}

const TYPE_META = {
  llm: { label: "LLM", icon: Zap },
  image: { label: "生图", icon: Image },
  video: { label: "视频", icon: Video },
} as const;

export default function CustomPresetLibrary({
  onApplyPreset,
  buildPayloads,
  notify,
}: CustomPresetLibraryProps) {
  const [presets, setPresets] = useState<CustomPresetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState({
    llm: "",
    image: "",
    video: "",
  });

  async function loadPresets() {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-presets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setPresets(Array.isArray(data.presets) ? data.presets : []);
    } catch (e) {
      notify(`加载自定义预设失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPresets();
  }, []);

  const grouped = useMemo(() => ({
    llm: presets.filter((preset) => preset.type === "llm"),
    image: presets.filter((preset) => preset.type === "image"),
    video: presets.filter((preset) => preset.type === "video"),
  }), [presets]);

  async function handleSavePreset(type: "llm" | "image" | "video") {
    const label = draftNames[type].trim();
    if (!label) {
      notify("请先输入预设名称", "error");
      return;
    }
    setBusyKey(`save:${type}`);
    try {
      const res = await fetch("/api/custom-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          label,
          payload: buildPayloads[type](),
          note: "本地自定义预设",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setPresets(Array.isArray(data.presets) ? data.presets : []);
      setDraftNames((prev) => ({ ...prev, [type]: "" }));
      notify(`已保存${TYPE_META[type].label}预设「${label}」`, "success");
    } catch (e) {
      notify(`保存失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeletePreset(preset: CustomPresetRecord) {
    setBusyKey(`delete:${preset.id}`);
    try {
      const res = await fetch(`/api/custom-presets?id=${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      setPresets(Array.isArray(data.presets) ? data.presets : []);
      notify(`已删除预设「${preset.label}」`, "success");
    } catch (e) {
      notify(`删除失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApplyPreset(preset: CustomPresetRecord) {
    setBusyKey(`apply:${preset.id}`);
    try {
      await onApplyPreset(preset);
      notify(`已应用预设「${preset.label}」`, "success");
    } catch (e) {
      notify(`应用失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col w-full border border-[var(--border-default)]">
      <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3">
          <Layers3 size={18} className="text-[var(--gold-primary)]" />
          <span className="text-[15px] font-semibold text-[var(--text-primary)]">自定义预设库</span>
          <span className="text-[11px] text-[var(--text-muted)]">本地明文保存，便于多项目复用</span>
        </div>
        <button
          onClick={loadPresets}
          disabled={loading || busyKey !== null}
          className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
        >
          {loading ? <Loader size={12} className="animate-spin" /> : <Layers3 size={12} />}
          刷新预设
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 p-6 border-b border-[var(--border-default)]">
        {(["llm", "image", "video"] as const).map((type) => {
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          return (
            <div key={type} className="flex flex-col gap-3 p-4 border border-[var(--border-default)] bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <Icon size={16} className="text-[var(--gold-primary)]" />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">保存当前{meta.label}配置</span>
              </div>
              <input
                value={draftNames[type]}
                onChange={(e) => setDraftNames((prev) => ({ ...prev, [type]: e.target.value }))}
                placeholder={`例如：${meta.label}主力方案`}
                className="px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
              />
              <button
                onClick={() => handleSavePreset(type)}
                disabled={busyKey !== null}
                className="flex items-center justify-center gap-1.5 px-3 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
              >
                {busyKey === `save:${type}` ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                保存为预设
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-4 p-6">
        {(["llm", "image", "video"] as const).map((type) => {
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          const items = grouped[type];
          return (
            <div key={type} className="flex flex-col border border-[var(--border-default)] min-h-[220px]">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
                <Icon size={15} className="text-[var(--gold-primary)]" />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">{meta.label} 预设</span>
                <span className="ml-auto text-[11px] text-[var(--text-muted)]">{items.length} 条</span>
              </div>
              <div className="flex flex-col">
                {items.length === 0 ? (
                  <div className="px-4 py-8 text-[12px] text-[var(--text-muted)]">
                    暂无已保存的{meta.label}预设。
                  </div>
                ) : (
                  items.map((preset) => (
                    <div
                      key={preset.id}
                      className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{preset.label}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {new Date(preset.updatedAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                      <button
                        onClick={() => handleApplyPreset(preset)}
                        disabled={busyKey !== null}
                        className="flex items-center gap-1 px-2 py-1.5 border border-[var(--gold-primary)]/30 text-[11px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
                      >
                        {busyKey === `apply:${preset.id}` ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
                        应用
                      </button>
                      <button
                        onClick={() => handleDeletePreset(preset)}
                        disabled={busyKey !== null}
                        className="flex items-center justify-center w-7 h-7 border border-red-500/20 text-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
                      >
                        {busyKey === `delete:${preset.id}` ? <Loader size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
