import fs from "fs";
import { resolveProjectFile } from "@/app/lib/runtimePaths";
import { createStarterWorkflowDocument } from "@/app/lib/comfyui/workflowTemplates";
import type { ComfyUiWorkflowDocument, ComfyUiWorkflowStore } from "@/app/lib/comfyui/workflowTypes";

const WORKFLOW_FILE = resolveProjectFile("feicai-comfyui-workflows.json");

function buildDefaultWorkflowStore(): ComfyUiWorkflowStore {
  const starter = createStarterWorkflowDocument("默认工作流");
  return {
    activeWorkflowId: starter.id,
    workflows: [starter],
    updatedAt: new Date().toISOString(),
  };
}

export function getComfyUiWorkflowFilePath(): string {
  return WORKFLOW_FILE;
}

export function getComfyUiWorkflowStore(): ComfyUiWorkflowStore {
  try {
    if (!fs.existsSync(WORKFLOW_FILE)) return buildDefaultWorkflowStore();
    const raw = fs.readFileSync(WORKFLOW_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ComfyUiWorkflowStore>;
    const workflows = Array.isArray(parsed.workflows) && parsed.workflows.length > 0
      ? parsed.workflows.map((item) => sanitizeWorkflow(item))
      : buildDefaultWorkflowStore().workflows;
    const activeWorkflowId = workflows.some((item) => item.id === parsed.activeWorkflowId)
      ? parsed.activeWorkflowId ?? workflows[0]?.id ?? null
      : workflows[0]?.id ?? null;
    return {
      activeWorkflowId,
      workflows,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return buildDefaultWorkflowStore();
  }
}

function sanitizeWorkflow(item: Partial<ComfyUiWorkflowDocument>): ComfyUiWorkflowDocument {
  const base = createStarterWorkflowDocument(typeof item.name === "string" && item.name.trim() ? item.name.trim() : "工作流");
  return {
    ...base,
    ...item,
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : base.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : base.name,
    description: typeof item.description === "string" ? item.description : base.description,
    platform: item.platform || base.platform,
    workflowId: typeof item.workflowId === "string" ? item.workflowId : base.workflowId,
    serverId: typeof item.serverId === "string" ? item.serverId : base.serverId,
    modules: Array.isArray(item.modules) ? item.modules : base.modules,
    connections: Array.isArray(item.connections) ? item.connections : base.connections,
    workflowText: typeof item.workflowText === "string" && item.workflowText.trim() ? item.workflowText : base.workflowText,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
}

export function saveComfyUiWorkflowStore(input: Partial<ComfyUiWorkflowStore>): ComfyUiWorkflowStore {
  const sanitized = Array.isArray(input.workflows) && input.workflows.length > 0
    ? input.workflows.map((item) => sanitizeWorkflow(item))
    : buildDefaultWorkflowStore().workflows;
  const activeWorkflowId = sanitized.some((item) => item.id === input.activeWorkflowId)
    ? input.activeWorkflowId ?? sanitized[0]?.id ?? null
    : sanitized[0]?.id ?? null;
  const next: ComfyUiWorkflowStore = {
    activeWorkflowId,
    workflows: sanitized,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
