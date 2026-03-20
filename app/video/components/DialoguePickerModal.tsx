"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid2X2, Grid3X3, Info, LayoutGrid, MessageSquareText, Sparkles, X } from "lucide-react";
import { loadGridImageUrlsFromDisk } from "../../lib/gridImageStore";
import { kvLoad } from "../../lib/kvDB";
import { extractDialogues, mergeDialogues, type ImportedDialogue } from "../lib/dialogues";

type DialogueTab = "four" | "nine" | "smartNine" | "custom";

interface DialogueCell {
  imageUrl: string;
  dialogues: ImportedDialogue[];
}

interface DialoguePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (dialogues: ImportedDialogue[]) => void;
  episode: string;
  selectedBeat: number;
  episodes: string[];
}

async function fetchOutputContent(filename: string): Promise<string> {
  try {
    const res = await fetch(`/api/outputs/${encodeURIComponent(filename)}?optional=1`);
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data?.content === "string" ? data.content : "";
  } catch {
    return "";
  }
}

export default function DialoguePickerModal({
  open,
  onClose,
  onSelect,
  episode,
  selectedBeat,
  episodes,
}: DialoguePickerModalProps) {
  const [dialogueTab, setDialogueTab] = useState<DialogueTab>("nine");
  const [browseEpisode, setBrowseEpisode] = useState(episode);
  const [browseBeat, setBrowseBeat] = useState(selectedBeat);
  const [cells, setCells] = useState<DialogueCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [customCount, setCustomCount] = useState(9);

  useEffect(() => {
    if (!open) return;
    setCells([]);
    setLoading(true);
    setBrowseEpisode(episode);
    setBrowseBeat(selectedBeat);

    let cancelled = false;
    (async () => {
      for (const candidate of ["smartNine", "nine", "four", "custom"] as DialogueTab[]) {
        try {
          let content = "";
          if (candidate === "smartNine") {
            const raw = await kvLoad(`feicai-smart-nine-prompts-${episode}`);
            if (raw) content = raw;
            if (!content) content = await fetchOutputContent(`beat-board-prompt-${episode}.md`);
          } else if (candidate === "nine") {
            const raw = await kvLoad(`feicai-nine-prompts-edited-${episode}`);
            if (raw) content = raw;
          } else if (candidate === "four") {
            content = await fetchOutputContent("beat-breakdown.md");
          } else {
            const raw = await kvLoad(`feicai-motion-prompts-custom-${episode}`);
            if (raw) content = raw;
          }
          if (content && /[「“"'‘]/.test(content)) {
            if (!cancelled) setDialogueTab(candidate);
            return;
          }
        } catch {
          // ignore and keep scanning
        }
      }
      if (!cancelled) setDialogueTab("nine");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, episode, selectedBeat]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const diskImages = await loadGridImageUrlsFromDisk(browseEpisode);
      let gridCount = dialogueTab === "four" ? 4 : 9;
      let customPrompts: string[] = [];
      if (dialogueTab === "custom") {
        try {
          const raw = await kvLoad(`feicai-custom-grid-prompts-${browseEpisode}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.gridCount === "number") {
              gridCount = parsed.gridCount;
              setCustomCount(parsed.gridCount);
            }
            if (Array.isArray(parsed?.prompts)) customPrompts = parsed.prompts;
          }
        } catch {
          // ignore
        }
      }

      const motionKey =
        dialogueTab === "four"
          ? `feicai-motion-prompts-four-${browseEpisode}-b${browseBeat}`
          : dialogueTab === "custom"
            ? `feicai-motion-prompts-custom-${browseEpisode}`
            : `feicai-motion-prompts-${dialogueTab}-${browseEpisode}`;

      let motionPrompts: string[] = [];
      try {
        const raw = await kvLoad(motionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          motionPrompts = Array.isArray(parsed) ? parsed : parsed?.beats || [];
        }
      } catch {
        // ignore
      }

      let ninePrompts: string[] = [];
      if (dialogueTab === "nine") {
        try {
          const raw = await kvLoad(`feicai-nine-prompts-edited-${browseEpisode}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) ninePrompts = parsed;
          }
          if (ninePrompts.length === 0) {
            const output = await fetchOutputContent(`nine-prompts-edited-${browseEpisode}.json`);
            if (output) {
              const parsed = JSON.parse(output);
              if (Array.isArray(parsed)) ninePrompts = parsed;
            }
          }
          if (ninePrompts.length === 0) {
            const boardContent = await fetchOutputContent(`beat-board-prompt-${browseEpisode}.md`);
            if (boardContent) {
              let jsonText = boardContent.trim();
              const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (fence) jsonText = fence[1].trim();
              const start = jsonText.indexOf("{");
              const end = jsonText.lastIndexOf("}");
              if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
              const parsed = JSON.parse(jsonText);
              if (Array.isArray(parsed?.shots)) {
                ninePrompts = parsed.shots.map((shot: { description?: string }) => shot.description || "");
              }
            }
          }
        } catch {
          // ignore
        }
      }

      let fourSections: string[] = [];
      if (dialogueTab === "four") {
        try {
          const beatContent = await fetchOutputContent("beat-breakdown.md");
          if (beatContent) {
            const epRegex = new RegExp("(?=^## 第[\\d一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖拾]+集)", "m");
            const epHeaderRegex = new RegExp("^## 第[\\d一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖拾]+集");
            const episodesContent = beatContent.split(epRegex).filter((part) => epHeaderRegex.test(part.trim()));
            const epIndex = Number.parseInt(browseEpisode.replace(/\D/g, ""), 10) - 1;
            const currentEpisodeContent = episodesContent[epIndex] || episodesContent[0] || "";
            const beats = currentEpisodeContent.split(/(?=^###\s*Beat\s*\d)/im);
            beats.shift();
            fourSections = beats;
          }
        } catch {
          // ignore
        }
      }

      let smartBeatPrompts: string[] = [];
      if (dialogueTab === "smartNine") {
        try {
          const raw = await kvLoad(`feicai-smart-nine-prompts-${browseEpisode}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            smartBeatPrompts = parsed?.beats || (Array.isArray(parsed) ? parsed : []);
          }
        } catch {
          // ignore
        }
      }

      let smartBeatDialogues: ImportedDialogue[][] = [];
      if (dialogueTab === "smartNine") {
        try {
          const boardContent = await fetchOutputContent(`beat-board-prompt-${browseEpisode}.md`);
          if (boardContent) {
            let jsonText = boardContent.trim();
            const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (fence) jsonText = fence[1].trim();
            const start = jsonText.indexOf("{");
            const end = jsonText.lastIndexOf("}");
            if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed?.shots)) {
              smartBeatDialogues = parsed.shots.map((shot: { camera?: string }) => extractDialogues(shot.camera || ""));
            }
          }
        } catch {
          // ignore
        }
      }

      const nextCells: DialogueCell[] = [];
      for (let index = 0; index < gridCount; index += 1) {
        const imageKey =
          dialogueTab === "four"
            ? `four-${browseEpisode}-${browseBeat}-${index}`
            : dialogueTab === "custom"
              ? `custom-${browseEpisode}-${index}`
              : dialogueTab === "smartNine"
                ? `smartNine-${browseEpisode}-${index}`
                : `nine-${browseEpisode}-${index}`;

        let dialogues: ImportedDialogue[] = [];
        dialogues = mergeDialogues(dialogues, extractDialogues(motionPrompts[index] || ""));
        if (dialogueTab === "custom") dialogues = mergeDialogues(dialogues, extractDialogues(customPrompts[index] || ""));
        if (dialogueTab === "four") dialogues = mergeDialogues(dialogues, extractDialogues(fourSections[browseBeat] || ""));
        if (dialogueTab === "nine" && ninePrompts[index]) {
          const promptText = ninePrompts[index];
          const imgIndex = promptText.indexOf("**[IMG]**");
          const sepIndex = promptText.indexOf("---V3SEP---");
          const endIndex = imgIndex >= 0 ? imgIndex : sepIndex >= 0 ? sepIndex : -1;
          dialogues = mergeDialogues(dialogues, extractDialogues(endIndex >= 0 ? promptText.slice(0, endIndex) : promptText));
        }
        if (dialogueTab === "smartNine") {
          const promptText = smartBeatPrompts[index] || "";
          const sepIndex = promptText.indexOf("---V3SEP---");
          dialogues = mergeDialogues(dialogues, extractDialogues(sepIndex >= 0 ? promptText.slice(0, sepIndex) : promptText));
          dialogues = mergeDialogues(dialogues, smartBeatDialogues[index] || []);
        }

        nextCells.push({
          imageUrl: diskImages[imageKey] || "",
          dialogues,
        });
      }

      if (!cancelled) {
        setCells(nextCells);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dialogueTab, browseEpisode, browseBeat]);

  const totalCount = useMemo(
    () => cells.reduce((sum, item) => sum + item.dialogues.length, 0),
    [cells],
  );
  const modalEpisodes = episodes.length > 0 ? episodes : ["ep01"];
  const gridClass = dialogueTab === "four" || (dialogueTab === "custom" && customCount <= 4) ? "grid-cols-2" : "grid-cols-3";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex flex-col w-[620px] max-h-[80vh] bg-[#1A1A1A] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between h-14 px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquareText size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">台词导入</span>
            {totalCount > 0 && (
              <span className="text-[11px] text-[var(--text-muted)] bg-[#0D0D0D] px-2 py-0.5 rounded">
                共 {totalCount} 条台词
              </span>
            )}
          </div>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-md bg-[#0A0A0A] hover:bg-[#2A2A2A] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        <div className="flex items-center gap-3 h-11 px-6 bg-[#12121280] shrink-0">
          <select
            value={browseEpisode}
            onChange={(event) => setBrowseEpisode(event.target.value)}
            suppressHydrationWarning
            className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] font-medium text-[var(--gold-primary)] outline-none cursor-pointer appearance-none"
          >
            {modalEpisodes.map((item) => (
              <option key={item} value={item} className="bg-[#0A0A0A]">
                {item.toUpperCase()}
              </option>
            ))}
          </select>
          {dialogueTab === "four" && (
            <select
              value={browseBeat}
              onChange={(event) => setBrowseBeat(Number(event.target.value))}
              suppressHydrationWarning
              className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none"
            >
              {Array.from({ length: 9 }, (_, index) => (
                <option key={index} value={index} className="bg-[#0A0A0A]">
                  组{index + 1}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <div className="flex items-center h-7 rounded border border-[var(--border-default)] overflow-hidden">
            {[
              { key: "four" as DialogueTab, icon: Grid2X2, label: "四宫格" },
              { key: "nine" as DialogueTab, icon: Grid3X3, label: "九宫格" },
              { key: "smartNine" as DialogueTab, icon: Sparkles, label: "智能分镜" },
              { key: "custom" as DialogueTab, icon: LayoutGrid, label: "自定义" },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => {
                  setDialogueTab(key);
                  setCells([]);
                  setLoading(true);
                }}
                className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${
                  dialogueTab === key
                    ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-[var(--border-default)]" />

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">加载中...</div>
          ) : (
            <div className={`grid ${gridClass} gap-3`}>
              {cells.map((cell, index) => {
                const hasDialogues = cell.dialogues.length > 0;
                return (
                  <button
                    key={`${browseEpisode}-${dialogueTab}-${index}`}
                    disabled={!hasDialogues}
                    onClick={() => {
                      if (!hasDialogues) return;
                      onSelect(cell.dialogues);
                      onClose();
                    }}
                    className={`group relative flex flex-col rounded-lg border overflow-hidden text-left transition-all ${
                      hasDialogues
                        ? "border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:shadow-[0_0_12px_rgba(201,169,98,0.15)] cursor-pointer"
                        : "border-[#2A2A2A] opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <div className={`w-full aspect-[16/9] bg-[#0A0A0A] flex items-center justify-center ${hasDialogues ? "group-hover:brightness-110" : ""}`}>
                      {cell.imageUrl ? (
                        <img src={cell.imageUrl} alt={`格${index + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)]">无图片</span>
                      )}
                    </div>
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${hasDialogues ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "bg-[#2A2A2A] text-[var(--text-muted)]"}`}>
                        格{index + 1}
                      </span>
                      {hasDialogues && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/80 text-white text-[9px] font-medium">
                          {cell.dialogues.length}条
                        </span>
                      )}
                    </div>
                    <div className="px-2.5 py-2 bg-[#141414] min-h-[52px]">
                      {hasDialogues ? (
                        <div className="flex flex-col gap-1">
                          {cell.dialogues.slice(0, 2).map((item, dialogueIndex) => (
                            <p key={dialogueIndex} className="text-[10px] leading-relaxed text-[var(--text-secondary)] truncate">
                              <span className="text-[var(--gold-primary)] font-medium">{item.role}：</span>
                              {item.text}
                            </p>
                          ))}
                          {cell.dialogues.length > 2 && (
                            <span className="text-[9px] text-[var(--text-muted)]">...还有 {cell.dialogues.length - 2} 条</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-[var(--text-muted)]">无台词</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="h-px bg-[var(--border-default)]" />
        <div className="flex items-center gap-2 h-9 px-6 bg-[#0D0D0D] shrink-0">
          <Info size={10} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">
            点击有台词的格子即可导入，台词将作为 AI 提示词生成的上下文。灰色格子表示无台词
          </span>
        </div>
      </div>
    </div>
  );
}
