export type ComfyUiWorkflowPlatform = "local" | "runninghub" | "liblibai" | "third-party";

export type ComfyUiModuleKind =
  | "checkpoint"
  | "positivePrompt"
  | "negativePrompt"
  | "latentImage"
  | "ksampler"
  | "vaeDecode"
  | "saveImage"
  | "loadImage";

export interface ComfyUiCanvasModule {
  id: string;
  kind: ComfyUiModuleKind;
  title: string;
  note?: string;
  config: Record<string, string>;
}

export interface ComfyUiCanvasConnection {
  id: string;
  fromModuleId: string;
  toModuleId: string;
  label?: string;
}

export interface ComfyUiWorkflowDocument {
  id: string;
  name: string;
  description?: string;
  platform: ComfyUiWorkflowPlatform;
  workflowId?: string;
  serverId?: string | null;
  modules: ComfyUiCanvasModule[];
  connections: ComfyUiCanvasConnection[];
  workflowText: string;
  updatedAt: string;
}

export interface ComfyUiWorkflowStore {
  activeWorkflowId: string | null;
  workflows: ComfyUiWorkflowDocument[];
  updatedAt: string;
}

export interface ComfyUiModuleTemplate {
  kind: ComfyUiModuleKind;
  title: string;
  description: string;
  defaults: Record<string, string>;
}
