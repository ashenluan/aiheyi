"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import type {
  ComfyUiCanvasConnection,
  ComfyUiCanvasModule,
  ComfyUiModuleKind,
  ComfyUiModuleTemplate,
} from "@/app/lib/comfyui/workflowTypes";

interface CanvasWorkspaceProps {
  modules: ComfyUiCanvasModule[];
  connections: ComfyUiCanvasConnection[];
  templates: ComfyUiModuleTemplate[];
  onAddModule: (kind: ComfyUiModuleKind) => void;
  onUpdateModule: (moduleId: string, patch: Partial<ComfyUiCanvasModule>) => void;
  onRemoveModule: (moduleId: string) => void;
  onMoveModule: (moduleId: string, direction: -1 | 1) => void;
  onAddConnection: (fromModuleId: string, toModuleId: string, label?: string) => void;
  onRemoveConnection: (connectionId: string) => void;
}

export default function CanvasWorkspace(props: CanvasWorkspaceProps) {
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [pendingFrom, setPendingFrom] = useState("");
  const [pendingTo, setPendingTo] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");

  const editingModule = useMemo(
    () => props.modules.find((item) => item.id === editingModuleId) ?? null,
    [editingModuleId, props.modules],
  );

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)_320px] gap-4 items-start">
      <aside className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">模块库</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            支持本地 ComfyUI、RunningHub、LiblibAI 和第三方算力的通用工作流骨架。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {props.templates.map((template) => (
            <button
              key={template.kind}
              type="button"
              onClick={() => props.onAddModule(template.kind)}
              className="rounded-xl border border-[var(--border-default)] px-3 py-3 text-left transition hover:border-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/5 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">{template.title}</span>
                <Plus size={12} className="text-[var(--gold-primary)]" />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{template.description}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 min-h-[620px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">工作流画布</h3>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">当前共 {props.modules.length} 个模块，按顺序组织并可编辑关键参数。</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {props.modules.map((module, index) => (
            <div key={module.id} className="rounded-2xl border border-[var(--border-default)] bg-black/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-[var(--gold-primary)]/15 px-2 py-0.5 text-[11px] text-[var(--gold-primary)]">
                      {index + 1}
                    </span>
                    <h4 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{module.title}</h4>
                    <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{module.kind}</span>
                  </div>
                  {module.note && <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{module.note}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(module.config).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-[var(--border-default)] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{key}</div>
                        <div className="mt-1 text-[11px] text-[var(--text-primary)] break-all">{value || "--"}</div>
                      </div>
                    ))}
                    {Object.keys(module.config).length === 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--border-default)] px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                        当前模块暂无可配置字段
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => props.onMoveModule(module.id, -1)} className="rounded-xl border border-[var(--border-default)] p-2 text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => props.onMoveModule(module.id, 1)} className="rounded-xl border border-[var(--border-default)] p-2 text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" onClick={() => setEditingModuleId(module.id)} className="rounded-xl border border-[var(--border-default)] p-2 text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    <Pencil size={12} />
                  </button>
                  <button type="button" onClick={() => props.onRemoveModule(module.id)} className="rounded-xl border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10 transition cursor-pointer">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {props.modules.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-6 py-14 text-center text-[12px] text-[var(--text-muted)]">
              还没有模块，先从左侧模块库添加一个起点节点。
            </div>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">连接关系</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">记录模块间的逻辑走向，方便后续映射到真实 ComfyUI 节点图。</p>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border-default)] p-3">
          <select value={pendingFrom} onChange={(event) => setPendingFrom(event.target.value)} className="rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]">
            <option value="">选择起点模块</option>
            {props.modules.map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}
          </select>
          <select value={pendingTo} onChange={(event) => setPendingTo(event.target.value)} className="rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]">
            <option value="">选择终点模块</option>
            {props.modules.map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}
          </select>
          <input value={pendingLabel} onChange={(event) => setPendingLabel(event.target.value)} placeholder="连接说明，如 samples / model" className="rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]" />
          <button
            type="button"
            onClick={() => {
              if (!pendingFrom || !pendingTo) return;
              props.onAddConnection(pendingFrom, pendingTo, pendingLabel.trim() || undefined);
              setPendingLabel("");
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--gold-primary)] px-3 py-2 text-[12px] font-medium text-[#0A0A0A] transition hover:brightness-110 cursor-pointer"
          >
            <Link2 size={12} />
            新增连接
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {props.connections.map((connection) => {
            const from = props.modules.find((item) => item.id === connection.fromModuleId)?.title || connection.fromModuleId;
            const to = props.modules.find((item) => item.id === connection.toModuleId)?.title || connection.toModuleId;
            return (
              <div key={connection.id} className="rounded-2xl border border-[var(--border-default)] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-medium text-[var(--text-primary)]">{from} → {to}</div>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{connection.label || "未命名连接"}</div>
                  </div>
                  <button type="button" onClick={() => props.onRemoveConnection(connection.id)} className="rounded-xl border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10 transition cursor-pointer">
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
          {props.connections.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-default)] px-4 py-10 text-center text-[12px] text-[var(--text-muted)]">
              还没有连接，可先保留空白，后面再逐步补充。
            </div>
          )}
        </div>
      </aside>

      {editingModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => setEditingModuleId(null)}>
          <div className="w-full max-w-[720px] rounded-3xl border border-[var(--border-default)] bg-[#121212] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[18px] font-semibold text-[var(--text-primary)]">编辑模块</h3>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{editingModule.kind}</p>
              </div>
              <button type="button" onClick={() => setEditingModuleId(null)} className="rounded-xl border border-[var(--border-default)] p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
                <X size={14} />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-4">
              <input
                value={editingModule.title}
                onChange={(event) => props.onUpdateModule(editingModule.id, { title: event.target.value })}
                className="rounded-2xl border border-[var(--border-default)] bg-transparent px-4 py-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
              />
              <textarea
                value={editingModule.note || ""}
                onChange={(event) => props.onUpdateModule(editingModule.id, { note: event.target.value })}
                placeholder="模块说明（可选）"
                className="min-h-[80px] rounded-2xl border border-[var(--border-default)] bg-transparent px-4 py-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
              />
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(editingModule.config).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-[11px] text-[var(--text-muted)]">{key}</label>
                    <input
                      value={value}
                      onChange={(event) => props.onUpdateModule(editingModule.id, { config: { ...editingModule.config, [key]: event.target.value } })}
                      className="rounded-2xl border border-[var(--border-default)] bg-transparent px-4 py-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
