"use client";

import { RefreshCw, Trash2, Wrench } from "lucide-react";

export interface WorkflowRecoveryPanelItem {
  id: string;
  label: string;
  detail: string;
  actionLabel?: string;
}

interface WorkflowRecoveryPanelProps {
  title: string;
  description: string;
  items: WorkflowRecoveryPanelItem[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll?: () => void;
  compact?: boolean;
}

export default function WorkflowRecoveryPanel({
  title,
  description,
  items,
  onRetry,
  onDismiss,
  onClearAll,
  compact = false,
}: WorkflowRecoveryPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className={`rounded-2xl border border-rose-500/20 bg-rose-500/8 ${compact ? "p-3" : "p-4"}`}>
      <div className={`flex ${compact ? "flex-col gap-3" : "items-start justify-between gap-4"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-rose-300/70">
            <Wrench size={12} className="text-rose-400" />
            <span>Recovery</span>
          </div>
          <h3 className={`mt-2 ${compact ? "text-[13px]" : "text-[15px]"} font-medium text-[var(--text-primary)]`}>{title}</h3>
          <p className={`mt-1 ${compact ? "text-[10px]" : "text-[11px]"} leading-relaxed text-[var(--text-muted)]`}>
            {description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[10px] text-rose-300">
            {items.length} 个待恢复
          </span>
          {onClearAll && items.length > 1 && (
            <button
              onClick={onClearAll}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-[10px] text-[var(--text-secondary)] transition hover:border-rose-400 hover:text-rose-300 cursor-pointer"
            >
              <Trash2 size={11} />
              <span>清空列表</span>
            </button>
          )}
        </div>
      </div>

      <div className={`mt-3 grid ${compact ? "grid-cols-1 gap-2" : "grid-cols-1 xl:grid-cols-2 gap-2.5"}`}>
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-rose-500/20 bg-[var(--surface-contrast)] p-3 shadow-[var(--theme-shadow-soft)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`${compact ? "text-[11px]" : "text-[12px]"} font-medium text-[var(--text-primary)]`}>
                  {item.label}
                </div>
                <p className={`mt-1 ${compact ? "text-[10px]" : "text-[11px]"} leading-relaxed text-[var(--text-muted)]`}>
                  {item.detail}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onRetry(item.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[10px] text-rose-200 transition hover:bg-rose-500/15 cursor-pointer"
                >
                  <RefreshCw size={11} />
                  <span>{item.actionLabel || "重试"}</span>
                </button>
                <button
                  onClick={() => onDismiss(item.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] cursor-pointer"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
