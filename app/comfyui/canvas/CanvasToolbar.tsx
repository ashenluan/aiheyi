"use client";

import { Loader, Plus, RefreshCw, Save, Send } from "lucide-react";
import type { ComfyUiWorkflowPlatform } from "@/app/lib/comfyui/workflowTypes";

interface CanvasToolbarProps {
  workflowName: string;
  workflowPlatform: ComfyUiWorkflowPlatform;
  onChangeName: (value: string) => void;
  onChangePlatform: (value: ComfyUiWorkflowPlatform) => void;
  onCreateModule: () => void;
  onSyncJson: () => void;
  onSave: () => void;
  onSubmit: () => void;
  saving: boolean;
  submitting: boolean;
}

export default function CanvasToolbar(props: CanvasToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <input
        value={props.workflowName}
        onChange={(event) => props.onChangeName(event.target.value)}
        placeholder="工作流名称"
        className="min-w-[220px] flex-1 rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
      />
      <select
        value={props.workflowPlatform}
        onChange={(event) => props.onChangePlatform(event.target.value as ComfyUiWorkflowPlatform)}
        className="rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
      >
        <option value="local">本地 ComfyUI</option>
        <option value="runninghub">RunningHub</option>
        <option value="liblibai">LiblibAI</option>
        <option value="third-party">第三方算力</option>
      </select>
      <button
        type="button"
        onClick={props.onCreateModule}
        className="flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] px-3 py-2 text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
      >
        <Plus size={12} />
        添加模块
      </button>
      <button
        type="button"
        onClick={props.onSyncJson}
        className="flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] px-3 py-2 text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] cursor-pointer"
      >
        <RefreshCw size={12} />
        从画布生成 JSON
      </button>
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.saving}
        className="flex items-center gap-1.5 rounded-xl border border-[var(--gold-primary)] px-3 py-2 text-[12px] text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/10 cursor-pointer disabled:opacity-50"
      >
        {props.saving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
        保存工作流
      </button>
      <button
        type="button"
        onClick={props.onSubmit}
        disabled={props.submitting}
        className="flex items-center gap-1.5 rounded-xl bg-[var(--gold-primary)] px-3 py-2 text-[12px] font-medium text-[#0A0A0A] transition hover:brightness-110 cursor-pointer disabled:opacity-50"
      >
        {props.submitting ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
        提交到队列
      </button>
    </div>
  );
}
