"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, CircleCheckBig, Clapperboard, Sparkles } from "lucide-react";
import type {
  WorkflowHandoffChecklist as WorkflowHandoffChecklistData,
  WorkflowHandoffItem,
  WorkflowHandoffStatus,
} from "../lib/workflowHandoff";

interface WorkflowHandoffChecklistProps {
  checklist: WorkflowHandoffChecklistData;
  compact?: boolean;
}

function toneClass(status: WorkflowHandoffStatus) {
  if (status === "ready") return "border-emerald-500/20 bg-emerald-500/10";
  if (status === "blocked") return "border-amber-500/20 bg-amber-500/10";
  return "border-sky-500/20 bg-sky-500/10";
}

function badgeClass(status: WorkflowHandoffStatus) {
  if (status === "ready") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  if (status === "blocked") return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  return "border-sky-500/30 bg-sky-500/10 text-sky-400";
}

function statusLabel(status: WorkflowHandoffStatus) {
  if (status === "ready") return "已就绪";
  if (status === "blocked") return "未就绪";
  return "建议处理";
}

function leadText(items: WorkflowHandoffItem[]) {
  const blocked = items.find((item) => item.status === "blocked");
  if (blocked) return `当前最需要先补的是「${blocked.label}」`;
  const attention = items.find((item) => item.status === "needs-attention");
  if (attention) return `主链路已可继续，建议顺手处理「${attention.label}」`;
  return "交接状态完整，可以直接进入下一步操作";
}

export default function WorkflowHandoffChecklist({
  checklist,
  compact = false,
}: WorkflowHandoffChecklistProps) {
  const router = useRouter();
  const overallStatus: WorkflowHandoffStatus = checklist.items.some((item) => item.status === "blocked")
    ? "blocked"
    : checklist.items.some((item) => item.status === "needs-attention")
      ? "needs-attention"
      : "ready";
  const lead = useMemo(() => leadText(checklist.items), [checklist.items]);

  return (
    <div className={`rounded-2xl border ${toneClass(overallStatus)} ${compact ? "p-3" : "p-4"}`}>
      <div className={`flex ${compact ? "flex-col gap-3" : "items-start justify-between gap-4"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
            <Clapperboard size={12} className="text-[var(--gold-primary)]" />
            <span>{checklist.stageLabel}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--gold-primary)]" />
            <h3 className={`${compact ? "text-[13px]" : "text-[15px]"} font-medium text-[var(--text-primary)]`}>{checklist.title}</h3>
          </div>
          <p className={`mt-1 ${compact ? "text-[10px]" : "text-[11px]"} leading-relaxed text-[var(--text-muted)]`}>
            {checklist.description}
          </p>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-transparent)] bg-[var(--surface-accent-soft)] px-3 py-1 text-[10px] text-[var(--gold-primary)]">
            <CircleCheckBig size={11} />
            <span>{checklist.summary}</span>
          </div>
        </div>
      </div>

      <div className={`mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-contrast)] px-3 py-2 text-[10px] shadow-[var(--theme-shadow-soft)] ${overallStatus === "blocked" ? "text-amber-300/90" : "text-[var(--text-secondary)]"}`}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={12} className={overallStatus === "blocked" ? "text-amber-400" : "text-[var(--gold-primary)]"} />
          <span>{lead}</span>
        </div>
      </div>

      <div className={`mt-3 flex items-stretch gap-2 overflow-x-auto pb-1 ${compact ? "" : ""}`}>
        {checklist.items.map((item) => (
          <div
            key={item.id}
            className={`shrink-0 rounded-xl border ${compact ? "min-w-[220px] max-w-[260px] px-2.5 py-2" : "min-w-[240px] max-w-[300px] px-3 py-2.5"} ${toneClass(item.status)}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`${compact ? "text-[11px]" : "text-[12px]"} font-medium text-[var(--text-primary)] shrink-0`}>
                {item.label}
              </span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] shrink-0 ${badgeClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
              <span className={`${compact ? "text-[10px]" : "text-[11px]"} text-[var(--text-muted)] min-w-0 flex-1 truncate`}>
                {item.detail}
              </span>
              {item.href && item.actionLabel && (
                <button
                  onClick={() => router.push(item.href!)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
                >
                  <span>{item.actionLabel}</span>
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
