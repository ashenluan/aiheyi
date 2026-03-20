export interface ComfyUiServer {
  id: string;
  name: string;
  url: string;
  note?: string;
  enabled: boolean;
}

export interface ComfyUiConfig {
  activeServerId: string | null;
  servers: ComfyUiServer[];
  updatedAt: string;
}

export interface ComfyUiStatus {
  serverId: string;
  serverName: string;
  url: string;
  online: boolean;
  latencyMs: number;
  queueRunning: number;
  queuePending: number;
  nodeCount: number;
  deviceName?: string;
  comfyVersion?: string;
  checkedAt: string;
  error?: string;
}

export interface ComfyUiSubmitResponse {
  success: boolean;
  serverId: string;
  serverName: string;
  url: string;
  clientId: string;
  promptId?: string;
  workflowNodes: number;
  rawResponse?: unknown;
  error?: string;
}
