"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyPlus, FileJson, Loader, Trash2, Workflow } from "lucide-react";
import { useToast } from "@/app/components/Toast";
import CanvasTab from "@/app/comfyui/canvas/CanvasTab";
import CanvasToolbar from "@/app/comfyui/canvas/CanvasToolbar";
import CanvasWorkspace from "@/app/comfyui/canvas/CanvasWorkspace";
import { COMFY_UI_MODULE_TEMPLATES, buildWorkflowTextFromCanvas, createCanvasModule, createStarterWorkflowDocument } from "@/app/lib/comfyui/workflowTemplates";
import type { ComfyUiServer, ComfyUiSubmitResponse } from "@/app/lib/comfyui/types";
import type { ComfyUiWorkflowDocument, ComfyUiWorkflowPlatform, ComfyUiWorkflowStore } from "@/app/lib/comfyui/workflowTypes";

interface CanvasWorkflowPanelProps {
  activeServer: ComfyUiServer | null;
}

export default function CanvasWorkflowPanel({ activeServer }: CanvasWorkflowPanelProps) {
  const { toast } = useToast();
  const [store, setStore] = useState<ComfyUiWorkflowStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"canvas" | "json">("canvas");
  const [submitResult, setSubmitResult] = useState<ComfyUiSubmitResponse | null>(null);

  const activeWorkflow = useMemo(
    () => store?.workflows.find((item) => item.id === store.activeWorkflowId) ?? store?.workflows[0] ?? null,
    [store],
  );

  async function loadWorkflowStore() {
    setLoading(true);
    try {
      const response = await fetch("/api/comfyui/workflow", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取工作流失败");
      setStore(data as ComfyUiWorkflowStore);
    } catch (error) {
      const starter = createStarterWorkflowDocument("默认工作流");
      setStore({ activeWorkflowId: starter.id, workflows: [starter], updatedAt: new Date().toISOString() });
      toast(error instanceof Error ? error.message : "读取工作流失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkflowStore();
  }, []);

  function updateStore(next: ComfyUiWorkflowStore) {
    setStore({ ...next, updatedAt: new Date().toISOString() });
  }

  function updateActiveWorkflow(mutator: (workflow: ComfyUiWorkflowDocument) => ComfyUiWorkflowDocument) {
    setStore((current) => {
      if (!current) return current;
      const targetId = current.activeWorkflowId ?? current.workflows[0]?.id;
      const workflows = current.workflows.map((item) =>
        item.id === targetId ? { ...mutator(item), updatedAt: new Date().toISOString() } : item,
      );
      return { ...current, workflows, updatedAt: new Date().toISOString() };
    });
  }

  async function saveWorkflowStore(nextStore = store) {
    if (!nextStore) return;
    setSaving(true);
    try {
      const response = await fetch("/api/comfyui/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextStore),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存工作流失败");
      setStore(data as ComfyUiWorkflowStore);
      toast("ComfyUI 工作流已保存", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存工作流失败", "error");
    } finally {
      setSaving(false);
    }
  }

  function createWorkflow() {
    const doc = createStarterWorkflowDocument(`工作流 ${((store?.workflows.length || 0) + 1)}`);
    setStore((current) => {
      if (!current) {
        return { activeWorkflowId: doc.id, workflows: [doc], updatedAt: new Date().toISOString() };
      }
      return {
        activeWorkflowId: doc.id,
        workflows: [...current.workflows, doc],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function cloneWorkflow() {
    if (!activeWorkflow) return;
    const copy: ComfyUiWorkflowDocument = {
      ...activeWorkflow,
      id: `workflow-copy-${Date.now()}`,
      name: `${activeWorkflow.name} 副本`,
      modules: activeWorkflow.modules.map((module) => ({
        ...module,
        id: `${module.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      connections: activeWorkflow.connections.map((connection) => ({
        ...connection,
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      updatedAt: new Date().toISOString(),
    };
    setStore((current) => {
      if (!current) return current;
      return {
        activeWorkflowId: copy.id,
        workflows: [...current.workflows, copy],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function removeWorkflow() {
    if (!store || !activeWorkflow) return;
    if (store.workflows.length <= 1) {
      toast("至少保留一个工作流", "info");
      return;
    }
    const workflows = store.workflows.filter((item) => item.id !== activeWorkflow.id);
    updateStore({ activeWorkflowId: workflows[0]?.id ?? null, workflows, updatedAt: new Date().toISOString() });
  }

  function syncJsonFromCanvas() {
    if (!activeWorkflow) return;
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      workflowText: buildWorkflowTextFromCanvas(workflow),
    }));
    toast("已根据画布生成新的 Workflow JSON", "success");
  }

  async function submitWorkflow() {
    if (!activeWorkflow) {
      toast("请先创建工作流", "error");
      return;
    }
    if (!activeServer) {
      toast("请先选择可用的 ComfyUI 服务器", "error");
      return;
    }

    try {
      JSON.parse(activeWorkflow.workflowText);
    } catch {
      toast("当前 Workflow JSON 格式不合法", "error");
      setTab("json");
      return;
    }

    setSubmitting(true);
    setSubmitResult(null);
    try {
      const response = await fetch("/api/comfyui/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: activeServer.id,
          url: activeServer.url,
          name: activeServer.name,
          workflow: activeWorkflow.workflowText,
        }),
      });
      const data = await response.json();
      setSubmitResult(data as ComfyUiSubmitResponse);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "提交失败");
      }
      toast(`工作流已提交到 ${activeServer.name}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "提交失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !store || !activeWorkflow) {
    return (
      <section className="flex items-center justify-center rounded-2xl border border-[var(--border-default)] p-6 min-h-[640px]">
        <Loader size={20} className="animate-spin text-[var(--gold-primary)]" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border-default)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Workflow size={18} className="text-[var(--gold-primary)]" />
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">ComfyUI 工作流画布</h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              当前目标：{activeServer ? `${activeServer.name} · ${activeServer.url}` : "未选择服务器"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeWorkflow.id}
            onChange={(event) => updateStore({ ...store, activeWorkflowId: event.target.value, updatedAt: new Date().toISOString() })}
            className="rounded-xl border border-[var(--border-default)] bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]"
          >
            {store.workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
            ))}
          </select>
          <button type="button" onClick={createWorkflow} className="flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
            <FileJson size={12} />
            新建
          </button>
          <button type="button" onClick={cloneWorkflow} className="flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
            <CopyPlus size={12} />
            复制
          </button>
          <button type="button" onClick={removeWorkflow} className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-[12px] text-red-400 hover:bg-red-500/10 transition cursor-pointer">
            <Trash2 size={12} />
            删除
          </button>
        </div>
      </div>

      <CanvasToolbar
        workflowName={activeWorkflow.name}
        workflowPlatform={activeWorkflow.platform}
        onChangeName={(value) => updateActiveWorkflow((workflow) => ({ ...workflow, name: value }))}
        onChangePlatform={(value) => updateActiveWorkflow((workflow) => ({ ...workflow, platform: value as ComfyUiWorkflowPlatform }))}
        onCreateModule={() => updateActiveWorkflow((workflow) => ({
          ...workflow,
          modules: [...workflow.modules, createCanvasModule("checkpoint")],
        }))}
        onSyncJson={syncJsonFromCanvas}
        onSave={() => saveWorkflowStore()}
        onSubmit={submitWorkflow}
        saving={saving}
        submitting={submitting}
      />

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[var(--border-default)] p-4">
          <div className="text-[11px] text-[var(--text-muted)]">工作流平台</div>
          <div className="mt-2 text-[14px] text-[var(--text-primary)]">{activeWorkflow.platform}</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">支持本地 ComfyUI、RunningHub、LiblibAI 和第三方算力映射。</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] p-4">
          <div className="text-[11px] text-[var(--text-muted)]">模块数量</div>
          <div className="mt-2 text-[14px] text-[var(--text-primary)]">{activeWorkflow.modules.length}</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">画布模块和 JSON 会一起保存，方便后续继续扩展。</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] p-4">
          <div className="text-[11px] text-[var(--text-muted)]">连接数量</div>
          <div className="mt-2 text-[14px] text-[var(--text-primary)]">{activeWorkflow.connections.length}</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">当前连接用于表达节点关系，后续可继续细化为更复杂的映射。</p>
        </div>
      </div>

      <CanvasTab value={tab} onChange={setTab} />

      {tab === "canvas" ? (
        <CanvasWorkspace
          modules={activeWorkflow.modules}
          connections={activeWorkflow.connections}
          templates={COMFY_UI_MODULE_TEMPLATES}
          onAddModule={(kind) => updateActiveWorkflow((workflow) => ({
            ...workflow,
            modules: [...workflow.modules, createCanvasModule(kind)],
          }))}
          onUpdateModule={(moduleId, patch) => updateActiveWorkflow((workflow) => ({
            ...workflow,
            modules: workflow.modules.map((module) => module.id === moduleId ? { ...module, ...patch, config: patch.config ?? module.config } : module),
          }))}
          onRemoveModule={(moduleId) => updateActiveWorkflow((workflow) => ({
            ...workflow,
            modules: workflow.modules.filter((module) => module.id !== moduleId),
            connections: workflow.connections.filter((connection) => connection.fromModuleId !== moduleId && connection.toModuleId !== moduleId),
          }))}
          onMoveModule={(moduleId, direction) => updateActiveWorkflow((workflow) => {
            const index = workflow.modules.findIndex((module) => module.id === moduleId);
            if (index === -1) return workflow;
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= workflow.modules.length) return workflow;
            const modules = [...workflow.modules];
            const [item] = modules.splice(index, 1);
            modules.splice(nextIndex, 0, item);
            return { ...workflow, modules };
          })}
          onAddConnection={(fromModuleId, toModuleId, label) => updateActiveWorkflow((workflow) => ({
            ...workflow,
            connections: [...workflow.connections, { id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, fromModuleId, toModuleId, label }],
          }))}
          onRemoveConnection={(connectionId) => updateActiveWorkflow((workflow) => ({
            ...workflow,
            connections: workflow.connections.filter((connection) => connection.id !== connectionId),
          }))}
        />
      ) : (
        <textarea
          value={activeWorkflow.workflowText}
          onChange={(event) => updateActiveWorkflow((workflow) => ({ ...workflow, workflowText: event.target.value }))}
          spellCheck={false}
          className="min-h-[640px] resize-y rounded-2xl border border-[var(--border-default)] bg-[#0D0D0D] px-4 py-3 font-mono text-[12px] leading-6 text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
        />
      )}

      {submitResult && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {submitResult.success ? "最近一次提交成功" : "最近一次提交失败"}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">{submitResult.serverName}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className="text-[11px] text-[var(--text-muted)]">Prompt ID</span>
              <p className="mt-1 font-mono text-[12px] text-[var(--text-primary)] break-all">{submitResult.promptId || "--"}</p>
            </div>
            <div>
              <span className="text-[11px] text-[var(--text-muted)]">Client ID</span>
              <p className="mt-1 font-mono text-[12px] text-[var(--text-primary)] break-all">{submitResult.clientId}</p>
            </div>
            <div>
              <span className="text-[11px] text-[var(--text-muted)]">节点数量</span>
              <p className="mt-1 text-[12px] text-[var(--text-primary)]">{submitResult.workflowNodes}</p>
            </div>
          </div>
          {submitResult.error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-400">
              {submitResult.error}
            </div>
          )}
          <pre className="max-h-[240px] overflow-auto rounded-xl bg-[#0D0D0D] px-4 py-3 text-[11px] leading-6 text-[var(--text-secondary)]">
            {JSON.stringify(submitResult.rawResponse ?? submitResult, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
