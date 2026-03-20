"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Info, Languages, Sparkles, Timer, X } from "lucide-react";
import {
  formatPromptLanguage,
  resolveVideoPromptProfile,
  type PromptLanguage,
} from "../lib/promptProfiles";
import type { ImportedDialogue } from "../lib/dialogues";

interface VideoModelOption {
  id: string;
  name: string;
  model: string;
}

interface AIPromptGenerateModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (options: { modelId?: string; outputLanguage: PromptLanguage; dialogues: ImportedDialogue[] }) => Promise<void> | void;
  videoModels: VideoModelOption[];
  currentModelId: string;
  dialogues: ImportedDialogue[];
  modeLabel: string;
  generating: boolean;
}

export default function AIPromptGenerateModal({
  open,
  onClose,
  onGenerate,
  videoModels,
  currentModelId,
  dialogues,
  modeLabel,
  generating,
}: AIPromptGenerateModalProps) {
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  const [outputLanguage, setOutputLanguage] = useState<PromptLanguage>("zh");
  const [dialogueExpanded, setDialogueExpanded] = useState(false);
  const [selectedDialogueFlags, setSelectedDialogueFlags] = useState<boolean[]>([]);
  const isBatchRelay = modeLabel === "批量接力";

  useEffect(() => {
    if (!open) return;
    setSelectedModelId(currentModelId);
    const current = videoModels.find((item) => item.id === currentModelId);
    const profile = resolveVideoPromptProfile(current?.model || current?.name || "");
    setOutputLanguage(profile.language === "en" ? "en" : "zh");
    setDialogueExpanded(false);
    setSelectedDialogueFlags(dialogues.map(() => !isBatchRelay));
  }, [open, currentModelId, videoModels, dialogues, isBatchRelay]);

  const selectedModel = useMemo(
    () => videoModels.find((item) => item.id === selectedModelId),
    [selectedModelId, videoModels],
  );
  const profile = useMemo(
    () => resolveVideoPromptProfile(selectedModel?.model || selectedModel?.name || ""),
    [selectedModel],
  );
  const effectiveDialogueFlags =
    selectedDialogueFlags.length === dialogues.length
      ? selectedDialogueFlags
      : dialogues.map(() => true);
  const selectedDialogues = dialogues.filter((_, index) => effectiveDialogueFlags[index]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[640px] max-h-[85vh] bg-[#141414] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">AI 动态提示词生成</span>
            <span className="text-[11px] text-[var(--text-muted)] bg-[#1A1A1A] px-2.5 py-1 rounded">{modeLabel}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#222] rounded transition cursor-pointer">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-[var(--text-secondary)]">目标视频模型</span>
            {videoModels.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
                {videoModels.map((item) => {
                  const itemProfile = resolveVideoPromptProfile(item.model || item.name);
                  const active = item.id === selectedModelId;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setSelectedModelId(item.id);
                        setOutputLanguage(itemProfile.language === "en" ? "en" : "zh");
                      }}
                      className={`flex flex-col gap-1 px-4 py-3 rounded-lg border text-left transition cursor-pointer ${
                        active
                          ? "border-[var(--gold-primary)] bg-[#C9A96215]"
                          : "border-[var(--border-subtle)] bg-[#0D0D0D] hover:border-[var(--border-default)]"
                      }`}
                    >
                      <span className={`text-[13px] font-medium truncate ${active ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>
                        {item.name}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)] truncate">
                        {itemProfile.label} · {itemProfile.maxLength}字
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[12px] text-[var(--text-muted)] py-4 text-center">未配置视频模型，将使用通用模式</span>
            )}
          </div>

          <div className="flex items-center gap-4 px-4 py-3 bg-[#0D0D0D] rounded-lg border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[12px] text-[var(--text-muted)]">时长 {profile.minDuration}-{profile.maxDuration}s</span>
            </div>
            <span className="text-[var(--border-subtle)]">|</span>
            <span className="text-[12px] text-[var(--text-muted)]">上限 {profile.maxLength} 字</span>
            <span className="text-[var(--border-subtle)]">|</span>
            <span className="text-[12px] text-[var(--text-muted)]">{formatPromptLanguage(profile.language)}</span>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Languages size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">输出语言</span>
            </div>
            <div className="flex items-center gap-2">
              {(["zh", "en"] as PromptLanguage[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setOutputLanguage(item)}
                  className={`flex-1 py-2.5 text-[13px] rounded-lg border transition cursor-pointer ${
                    outputLanguage === item
                      ? "border-[var(--gold-primary)] bg-[#C9A96215] text-[var(--gold-primary)] font-medium"
                      : "border-[var(--border-subtle)] bg-[#0D0D0D] text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                  }`}
                >
                  {item === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          </div>

          {dialogues.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <button onClick={() => setDialogueExpanded((value) => !value)} className="flex items-center gap-2 cursor-pointer">
                <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${dialogueExpanded ? "rotate-180" : ""}`} />
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">关联台词（{dialogues.length}条）</span>
                <span className="text-[11px] text-[var(--text-muted)]">— 勾选的台词将注入 AI 上下文</span>
              </button>
              {dialogueExpanded && (
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {dialogues.map((item, index) => (
                    <label key={`${item.role}-${item.text}-${index}`} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1A1A1A] transition cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effectiveDialogueFlags[index]}
                        onChange={() =>
                          setSelectedDialogueFlags((prev) => {
                            const next = prev.length === dialogues.length ? [...prev] : dialogues.map(() => true);
                            next[index] = !next[index];
                            return next;
                          })
                        }
                        className="mt-0.5 w-4 h-4 accent-[var(--gold-primary)]"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] font-medium text-[var(--gold-primary)]">{item.role}</span>
                        {item.emotion && <span className="text-[11px] text-[var(--text-muted)] ml-1.5">({item.emotion})</span>}
                        <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed break-all mt-0.5">{item.text}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 px-3">
            <Info size={14} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
            <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              AI 将根据所选平台规格 + 分镜描述 + 参考图片 + 台词上下文生成适配的动态提示词，并推荐最佳视频时长。
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer rounded"
          >
            取消
          </button>
          <button
            onClick={() => onGenerate({ modelId: selectedModelId, outputLanguage, dialogues: selectedDialogues })}
            disabled={generating}
            className="px-4 py-2 text-[13px] bg-[var(--gold-primary)] text-[#0A0A0A] font-semibold hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed rounded flex items-center gap-1.5"
          >
            <Sparkles size={12} />
            {generating ? "生成中..." : "生成提示词"}
          </button>
        </div>
      </div>
    </div>
  );
}
