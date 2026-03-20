import fs from "fs";
import { randomUUID } from "crypto";
import type { ComfyUiConfig, ComfyUiServer, ComfyUiStatus } from "@/app/lib/comfyui/types";
import { resolveProjectFile } from "@/app/lib/runtimePaths";

const CONFIG_FILE = resolveProjectFile("feicai-comfyui.json");

const DEFAULT_SERVER: ComfyUiServer = {
  id: "local-default",
  name: "本地默认 ComfyUI",
  url: "http://127.0.0.1:8188",
  note: "建议开启 --listen 便于本机接入",
  enabled: true,
};

function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function sanitizeServer(server: Partial<ComfyUiServer>, index: number): ComfyUiServer {
  const id = typeof server.id === "string" && server.id.trim()
    ? server.id.trim()
    : `comfy-${index + 1}-${randomUUID().slice(0, 8)}`;
  const url = normalizeServerUrl(typeof server.url === "string" ? server.url : "");

  return {
    id,
    name: typeof server.name === "string" && server.name.trim() ? server.name.trim() : `ComfyUI ${index + 1}`,
    url: url || DEFAULT_SERVER.url,
    note: typeof server.note === "string" ? server.note.trim() : "",
    enabled: server.enabled !== false,
  };
}

function buildDefaultConfig(): ComfyUiConfig {
  return {
    activeServerId: DEFAULT_SERVER.id,
    servers: [DEFAULT_SERVER],
    updatedAt: new Date().toISOString(),
  };
}

export function getComfyUiConfigFilePath(): string {
  return CONFIG_FILE;
}

export function getComfyUiConfig(): ComfyUiConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return buildDefaultConfig();
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ComfyUiConfig>;
    const servers = Array.isArray(parsed.servers) && parsed.servers.length > 0
      ? parsed.servers.map((server, index) => sanitizeServer(server, index))
      : [DEFAULT_SERVER];

    const activeExists = servers.some((server) => server.id === parsed.activeServerId);
    return {
      activeServerId: activeExists ? parsed.activeServerId ?? null : servers[0]?.id ?? null,
      servers,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return buildDefaultConfig();
  }
}

export function saveComfyUiConfig(config: Partial<ComfyUiConfig>): ComfyUiConfig {
  const nextServers = Array.isArray(config.servers) && config.servers.length > 0
    ? config.servers.map((server, index) => sanitizeServer(server, index))
    : [DEFAULT_SERVER];

  const activeServerId = nextServers.some((server) => server.id === config.activeServerId)
    ? config.activeServerId ?? null
    : nextServers[0]?.id ?? null;

  const nextConfig: ComfyUiConfig = {
    activeServerId,
    servers: nextServers,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(nextConfig, null, 2), "utf-8");
  return nextConfig;
}

export function resolveComfyUiServer(input?: {
  serverId?: string | null;
  url?: string | null;
  name?: string | null;
}): ComfyUiServer | null {
  if (input?.url && input.url.trim()) {
    return {
      id: input.serverId?.trim() || "adhoc-server",
      name: input.name?.trim() || "临时 ComfyUI 服务器",
      url: normalizeServerUrl(input.url),
      note: "",
      enabled: true,
    };
  }

  const config = getComfyUiConfig();
  if (input?.serverId) {
    const matched = config.servers.find((server) => server.id === input.serverId);
    if (matched) return matched;
  }

  if (config.activeServerId) {
    const active = config.servers.find((server) => server.id === config.activeServerId);
    if (active) return active;
  }

  return config.servers.find((server) => server.enabled) ?? config.servers[0] ?? null;
}

function countQueueItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)) {
    return (value as { items: unknown[] }).items.length;
  }
  return 0;
}

export async function fetchComfyUiStatus(server: ComfyUiServer): Promise<ComfyUiStatus> {
  const startedAt = Date.now();
  const baseUrl = normalizeServerUrl(server.url);

  const [systemStatsResult, queueResult, objectInfoResult] = await Promise.allSettled([
    fetch(`${baseUrl}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(6000) }),
    fetch(`${baseUrl}/queue`, { cache: "no-store", signal: AbortSignal.timeout(6000) }),
    fetch(`${baseUrl}/object_info`, { cache: "no-store", signal: AbortSignal.timeout(6000) }),
  ]);

  const statusBase = {
    serverId: server.id,
    serverName: server.name,
    url: baseUrl,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };

  const online =
    (systemStatsResult.status === "fulfilled" && systemStatsResult.value.ok) ||
    (queueResult.status === "fulfilled" && queueResult.value.ok) ||
    (objectInfoResult.status === "fulfilled" && objectInfoResult.value.ok);

  if (!online) {
    const friendlyBase = `无法连接到 ${server.name}（${baseUrl}）`;
    const errorMessage =
      systemStatsResult.status === "rejected"
        ? systemStatsResult.reason instanceof Error
          ? `${friendlyBase}: ${systemStatsResult.reason.message}`
          : friendlyBase
        : queueResult.status === "rejected"
        ? queueResult.reason instanceof Error
          ? `${friendlyBase}: ${queueResult.reason.message}`
          : `${friendlyBase}: 无法读取队列状态`
        : `${friendlyBase}: ComfyUI 未响应`;

    return {
      ...statusBase,
      online: false,
      queueRunning: 0,
      queuePending: 0,
      nodeCount: 0,
      error: errorMessage,
    };
  }

  const systemStats =
    systemStatsResult.status === "fulfilled" && systemStatsResult.value.ok
      ? await systemStatsResult.value.json().catch(() => null)
      : null;
  const queueData =
    queueResult.status === "fulfilled" && queueResult.value.ok
      ? await queueResult.value.json().catch(() => null)
      : null;
  const objectInfo =
    objectInfoResult.status === "fulfilled" && objectInfoResult.value.ok
      ? await objectInfoResult.value.json().catch(() => null)
      : null;

  const deviceName =
    (systemStats as { devices?: Array<{ name?: string }> })?.devices?.[0]?.name ||
    (systemStats as { system?: { devices?: Array<{ name?: string }> } })?.system?.devices?.[0]?.name ||
    "";
  const comfyVersion =
    (systemStats as { system?: { comfyui_version?: string; git_hash?: string } })?.system?.comfyui_version ||
    (systemStats as { system?: { git_hash?: string } })?.system?.git_hash ||
    "";

  return {
    ...statusBase,
    online: true,
    queueRunning: countQueueItems((queueData as { queue_running?: unknown })?.queue_running),
    queuePending: countQueueItems((queueData as { queue_pending?: unknown })?.queue_pending),
    nodeCount: objectInfo && typeof objectInfo === "object" ? Object.keys(objectInfo).length : 0,
    deviceName,
    comfyVersion,
  };
}
