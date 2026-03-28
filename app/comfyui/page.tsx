"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "../components/Sidebar";
import { useToast } from "../components/Toast";
import type { ComfyUiConfig, ComfyUiServer } from "@/app/lib/comfyui/types";
import {
  COMFY_UI_BUILTIN_PRESETS,
  COMFY_UI_PLATFORM_OPTIONS,
  createDefaultOfficialComfyUiSettings,
  detectNodeMappingsFromWorkflow,
  parseWorkflowIdFromInput,
  type ComfyUiOfficialSettings,
  type ComfyUiPlatformKey,
  type ComfyUiWorkflowNodeMapping,
  type ComfyUiWorkflowPreset,
} from "@/app/lib/comfyui/platformConfig";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Loader,
  Plus,
  Search,
  Trash2,
  Upload,
  Wifi,
  X,
  Zap,
} from "lucide-react";

const SETTINGS_STORAGE_KEY = "comfyui-settings";

const IMAGE_NODE_MAPPINGS: ComfyUiWorkflowNodeMapping[] = [
  { role: "prompt", nodeId: "6", field: "text", nodeType: "CLIPTextEncode" },
  { role: "refImage", nodeId: "3", field: "image", nodeType: "LoadImage" },
  { role: "output", nodeId: "9", field: "images", nodeType: "SaveImage" },
];

const VIDEO_NODE_MAPPINGS: ComfyUiWorkflowNodeMapping[] = [
  { role: "prompt", nodeId: "6", field: "text", nodeType: "CLIPTextEncode" },
  { role: "refImage", nodeId: "3", field: "image", nodeType: "LoadImage" },
  { role: "output", nodeId: "12", field: "video", nodeType: "SaveVideo" },
];

type ServerState = {
  status: "online" | "offline" | "testing" | "error";
  latencyMs?: number;
  errorMsg?: string;
  lastCheck?: number;
};

function cloneDefaultSettings(): ComfyUiOfficialSettings {
  return createDefaultOfficialComfyUiSettings();
}

function mergeOfficialSettings(raw: unknown): ComfyUiOfficialSettings {
  const base = cloneDefaultSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;

  const input = raw as Partial<ComfyUiOfficialSettings>;

  return {
    activePlatform:
      input.activePlatform === "runninghub" ||
      input.activePlatform === "liblib" ||
      input.activePlatform === "thirdparty"
        ? input.activePlatform
        : base.activePlatform,
    runninghub: {
      apiKey: typeof input.runninghub?.apiKey === "string" ? input.runninghub.apiKey : base.runninghub.apiKey,
      workflow: {
        ...base.runninghub.workflow,
        ...(input.runninghub?.workflow || {}),
      },
      nodeMappings: Array.isArray(input.runninghub?.nodeMappings)
        ? (input.runninghub.nodeMappings as ComfyUiWorkflowNodeMapping[])
        : base.runninghub.nodeMappings,
    },
    liblib: {
      apiKey: typeof input.liblib?.apiKey === "string" ? input.liblib.apiKey : base.liblib.apiKey,
      workflow: {
        ...base.liblib.workflow,
        ...(input.liblib?.workflow || {}),
      },
      nodeMappings: Array.isArray(input.liblib?.nodeMappings)
        ? (input.liblib.nodeMappings as ComfyUiWorkflowNodeMapping[])
        : base.liblib.nodeMappings,
    },
    thirdparty: {
      workflow: {
        ...base.thirdparty.workflow,
        ...(input.thirdparty?.workflow || {}),
      },
      nodeMappings: Array.isArray(input.thirdparty?.nodeMappings)
        ? (input.thirdparty.nodeMappings as ComfyUiWorkflowNodeMapping[])
        : base.thirdparty.nodeMappings,
    },
    customPresets: Array.isArray(input.customPresets)
      ? (input.customPresets as ComfyUiWorkflowPreset[])
      : base.customPresets,
    activePresetId: typeof input.activePresetId === "string" ? input.activePresetId : undefined,
  };
}

function getWorkflowConfig(settings: ComfyUiOfficialSettings, platform: ComfyUiPlatformKey) {
  return platform === "thirdparty" ? settings.thirdparty.workflow : settings[platform].workflow;
}

function getNodeMappings(settings: ComfyUiOfficialSettings, platform: ComfyUiPlatformKey) {
  return platform === "thirdparty" ? settings.thirdparty.nodeMappings : settings[platform].nodeMappings;
}

function getApiKey(settings: ComfyUiOfficialSettings, platform: ComfyUiPlatformKey) {
  return platform === "thirdparty" ? "" : settings[platform].apiKey;
}

function setWorkflowConfig(
  settings: ComfyUiOfficialSettings,
  platform: ComfyUiPlatformKey,
  workflow: ComfyUiOfficialSettings["runninghub"]["workflow"],
): ComfyUiOfficialSettings {
  if (platform === "thirdparty") {
    return {
      ...settings,
      thirdparty: {
        ...settings.thirdparty,
        workflow,
      },
    };
  }

  return {
    ...settings,
    [platform]: {
      ...settings[platform],
      workflow,
    },
  };
}

function setNodeMappingsForPlatform(
  settings: ComfyUiOfficialSettings,
  platform: ComfyUiPlatformKey,
  nodeMappings: ComfyUiWorkflowNodeMapping[],
): ComfyUiOfficialSettings {
  if (platform === "thirdparty") {
    return {
      ...settings,
      thirdparty: {
        ...settings.thirdparty,
        nodeMappings,
      },
    };
  }

  return {
    ...settings,
    [platform]: {
      ...settings[platform],
      nodeMappings,
    },
  };
}

function setApiKeyForPlatform(
  settings: ComfyUiOfficialSettings,
  platform: ComfyUiPlatformKey,
  apiKey: string,
): ComfyUiOfficialSettings {
  if (platform === "thirdparty") return settings;
  return {
    ...settings,
    [platform]: {
      ...settings[platform],
      apiKey,
    },
  };
}

function inferNodeMappings(preset?: ComfyUiWorkflowPreset, workflowId = "") {
  if (preset?.nodeMappings?.length) return preset.nodeMappings;
  const isVideo = preset?.tags?.includes("video") || /video|hunyuan|wan|sora/i.test(workflowId);
  return isVideo ? VIDEO_NODE_MAPPINGS : IMAGE_NODE_MAPPINGS;
}

function normalizeImportedPreset(input: unknown): ComfyUiWorkflowPreset[] {
  const items = Array.isArray(input) ? input : [input];
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个预设格式无效`);
    }

    const preset = item as Partial<ComfyUiWorkflowPreset>;
    if (!preset.name || typeof preset.name !== "string") {
      throw new Error(`第 ${index + 1} 个预设缺少 name`);
    }

    const platform =
      preset.platform === "liblib" || preset.platform === "thirdparty" ? preset.platform : "runninghub";
    const nodeMappings = Array.isArray(preset.nodeMappings)
      ? (preset.nodeMappings as ComfyUiWorkflowNodeMapping[])
      : inferNodeMappings(undefined, preset.workflowId || "");

    return {
      id: typeof preset.id === "string" && preset.id.trim() ? preset.id : `custom_${Date.now()}_${index}`,
      name: preset.name.trim(),
      description: typeof preset.description === "string" ? preset.description : "",
      tags: Array.isArray(preset.tags) ? preset.tags.map(String) : ["自定义"],
      runs: typeof preset.runs === "string" ? preset.runs : "0",
      platform,
      workflowId: typeof preset.workflowId === "string" ? preset.workflowId : "",
      nodeMappings,
    };
  });
}

function createServerDraft(index: number): ComfyUiServer {
  return {
    id: `srv_${Date.now()}_${index}`,
    name: `ComfyUI ${index + 1}`,
    url: "http://127.0.0.1:8188",
    note: "",
    enabled: true,
  };
}

export default function ComfyUiPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ComfyUiOfficialSettings>(() => cloneDefaultSettings());
  const [servers, setServers] = useState<ComfyUiServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [serverStates, setServerStates] = useState<Record<string, ServerState>>({});
  const [configFile, setConfigFile] = useState("");
  const [ready, setReady] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [checkingServerId, setCheckingServerId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [addingServer, setAddingServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerAddress, setNewServerAddress] = useState("");
  const [deleteServerId, setDeleteServerId] = useState<string | null>(null);
  const [editingPreset, setEditingPreset] = useState<ComfyUiWorkflowPreset | null>(null);
  const [deletePresetId, setDeletePresetId] = useState<string | null>(null);
  const [detectingMappings, setDetectingMappings] = useState(false);

  const activePlatform = settings.activePlatform;
  const isThirdParty = activePlatform === "thirdparty";
  const currentWorkflow = getWorkflowConfig(settings, activePlatform);
  const currentNodeMappings = getNodeMappings(settings, activePlatform);
  const currentApiKey = getApiKey(settings, activePlatform);
  const presets = useMemo(() => [...COMFY_UI_BUILTIN_PRESETS, ...settings.customPresets], [settings.customPresets]);
  const onlineCount = useMemo(() => Object.values(serverStates).filter((state) => state.status === "online").length, [serverStates]);

  useEffect(() => {
    (async () => {
      try {
        const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) setSettings(mergeOfficialSettings(JSON.parse(stored)));
      } catch {
        // ignore invalid local settings
      }

      try {
        const response = await fetch("/api/comfyui/servers", { cache: "no-store" });
        const data = (await response.json()) as ComfyUiConfig & { configFile?: string };
        if (response.ok) {
          setServers(data.servers || []);
          setActiveServerId(data.activeServerId ?? data.servers?.[0]?.id ?? null);
          setConfigFile(data.configFile || "");
        } else {
          setServers([createServerDraft(0)]);
        }
      } catch {
        setServers([createServerDraft(0)]);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [ready, settings]);

  async function saveConfig() {
    setSaving(true);
    try {
      const response = await fetch("/api/comfyui/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers, activeServerId: activeServerId ?? servers[0]?.id ?? null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setConfigFile(data.configFile || "");
      toast("配置已保存", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function testPlatformConnection() {
    if (isThirdParty) {
      await checkAllServers();
      return;
    }

    if (!currentApiKey.trim()) {
      toast("请先填写 API Key", "error");
      return;
    }

    setTestingConnection(true);
    try {
      const response = await fetch("/api/comfyui/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", platform: activePlatform, apiKey: currentApiKey }),
      });
      const data = await response.json();
      if (!response.ok || data.online === false) throw new Error(data.message || "连接失败");
      toast(data.message || "连接成功", "success");
      if (currentWorkflow.workflowId.trim()) {
        setSettings((current) =>
          setWorkflowConfig(current, activePlatform, {
            ...getWorkflowConfig(current, activePlatform),
            verified: true,
          }),
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "连接失败", "error");
    } finally {
      setTestingConnection(false);
    }
  }

  async function checkServer(server: ComfyUiServer) {
    setCheckingServerId(server.id);
    setServerStates((current) => ({ ...current, [server.id]: { ...current[server.id], status: "testing" } }));
    try {
      const response = await fetch("/api/comfyui/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", platform: "thirdparty", serverId: server.id, address: server.url, name: server.name }),
      });
      const data = await response.json();
      setServerStates((current) => ({
        ...current,
        [server.id]: {
          status: response.ok && data.online ? "online" : "offline",
          latencyMs: data.latencyMs,
          errorMsg: response.ok ? undefined : data.message,
          lastCheck: Date.now(),
        },
      }));
      if (!response.ok || data.online === false) throw new Error(data.message || "离线");
      toast(`${server.name}: 连接成功${data.latencyMs ? ` (${data.latencyMs}ms)` : ""}`, "success");
    } catch (error) {
      setServerStates((current) => ({
        ...current,
        [server.id]: {
          status: "error",
          errorMsg: error instanceof Error ? error.message : "连接失败",
          lastCheck: Date.now(),
        },
      }));
      toast(`${server.name}: ${error instanceof Error ? error.message : "连接失败"}`, "error");
    } finally {
      setCheckingServerId(null);
    }
  }
  async function checkAllServers() {
    if (servers.length === 0) {
      toast("暂无服务器", "error");
      return;
    }
    for (let index = 0; index < servers.length; index += 1) {
      setBulkProgress({ current: index + 1, total: servers.length });
      await checkServer(servers[index]);
    }
    setBulkProgress(null);
    toast(`批量测试完成 (${servers.length} 台)`, "success");
  }

  function addServer() {
    if (!newServerName.trim() || !newServerAddress.trim()) {
      toast("请填写名称和服务器地址", "error");
      return;
    }
    try {
      new URL(newServerAddress.trim());
    } catch {
      toast("服务器地址格式无效，需包含协议", "error");
      return;
    }

    const server: ComfyUiServer = {
      id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: newServerName.trim(),
      url: newServerAddress.trim(),
      note: "",
      enabled: true,
    };

    setServers((current) => [...current, server]);
    setActiveServerId((current) => current ?? server.id);
    setAddingServer(false);
    setNewServerName("");
    setNewServerAddress("");
    toast(`已添加: ${server.name}`, "success");
  }

  function removeServer(serverId: string) {
    if (servers.length <= 1) {
      toast("至少保留一个服务器", "info");
      return;
    }
    const remaining = servers.filter((server) => server.id !== serverId);
    setServers(remaining);
    if (activeServerId === serverId) setActiveServerId(remaining[0]?.id ?? null);
    setDeleteServerId(null);
    toast("服务器已删除", "success");
  }

  function applyWorkflowIdInput(value: string) {
    setSettings((current) =>
      setWorkflowConfig(current, activePlatform, {
        ...getWorkflowConfig(current, activePlatform),
        workflowId: value,
        verified: false,
      }),
    );
  }

  function parseWorkflowUrl() {
    if (isThirdParty) return;
    if (!currentWorkflow.workflowId.trim()) {
      toast("请先输入工作流 URL 或 ID", "error");
      return;
    }
    const parsed = parseWorkflowIdFromInput(currentWorkflow.workflowId);
    applyWorkflowIdInput(parsed);
    toast(parsed !== currentWorkflow.workflowId ? `已解析 ID: ${parsed}` : "未检测到 URL 格式，已保留原始内容", "success");
  }

  function autoDetectMappings() {
    if (!currentWorkflow.workflowId.trim()) {
      toast("请先填写工作流 ID", "error");
      return;
    }
    setDetectingMappings(true);
    window.setTimeout(() => {
      const activePreset = presets.find((item) => item.id === settings.activePresetId);
      const mappings = inferNodeMappings(activePreset, currentWorkflow.workflowId);
      setSettings((current) => setNodeMappingsForPlatform(current, activePlatform, mappings));
      setDetectingMappings(false);
      toast("已自动检测并填充节点映射 (通用模板)", "success");
    }, 800);
  }

  function applyPreset(preset: ComfyUiWorkflowPreset) {
    setSettings((current) => {
      const nextWithPlatform = { ...current, activePlatform: preset.platform, activePresetId: preset.id };
      const nextWithWorkflow = setWorkflowConfig(nextWithPlatform, preset.platform, {
        ...getWorkflowConfig(nextWithPlatform, preset.platform),
        workflowId: preset.workflowId,
        workflowName: preset.name,
        verified: false,
        nodeCount: undefined,
        inputCount: undefined,
      });
      return setNodeMappingsForPlatform(nextWithWorkflow, preset.platform, preset.nodeMappings);
    });
    toast(`已应用预设: ${preset.name}`, "success");
  }

  function exportPreset(preset: ComfyUiWorkflowPreset) {
    const blob = new Blob([
      JSON.stringify(
        {
          name: preset.name,
          description: preset.description,
          tags: preset.tags,
          platform: preset.platform,
          workflowId: preset.workflowId,
          nodeMappings: preset.nodeMappings,
        },
        null,
        2,
      ),
    ], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `comfyui-preset-${preset.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`已导出: ${preset.name}`, "success");
  }

  function clonePreset(preset: ComfyUiWorkflowPreset) {
    const cloned: ComfyUiWorkflowPreset = {
      ...preset,
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${preset.name} (副本)`,
      runs: "0",
    };
    setSettings((current) => ({ ...current, customPresets: [...current.customPresets, cloned] }));
    setEditingPreset(cloned);
    toast("已创建副本，可自由编辑", "success");
  }

  async function importPresetFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = normalizeImportedPreset(parsed);
      setSettings((current) => ({ ...current, customPresets: [...current.customPresets, ...imported] }));
      toast(`已导入 ${imported.length} 个工作流预设`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "导入失败：JSON 格式无效", "error");
    }
  }

  async function importWorkflowFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const detectedMappings = detectNodeMappingsFromWorkflow(parsed);
      const nodeCount =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed as Record<string, unknown>).length : undefined;
      const nextMappings = detectedMappings.length > 0 ? detectedMappings : inferNodeMappings(undefined, file.name);
      const workflowLabel =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).name === "string"
          ? String((parsed as Record<string, unknown>).name)
          : file.name.replace(/\.json$/i, "");
      setSettings((current) => {
        const next = setWorkflowConfig(current, activePlatform, {
          ...getWorkflowConfig(current, activePlatform),
          workflowId: workflowLabel,
          workflowName: workflowLabel,
          verified: true,
          nodeCount,
          inputCount: nextMappings.length,
        });
        return setNodeMappingsForPlatform(next, activePlatform, nextMappings);
      });
      toast(`已导入工作流：${file.name}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "工作流 JSON 无效", "error");
    }
  }

  function saveEditedPreset(preset: ComfyUiWorkflowPreset) {
    setSettings((current) => ({
      ...current,
      customPresets: current.customPresets.map((item) => (item.id === preset.id ? preset : item)),
    }));
    setEditingPreset(null);
    toast(`工作流“${preset.name}”已保存`, "success");
  }

  function removePreset(presetId: string) {
    setSettings((current) => ({
      ...current,
      customPresets: current.customPresets.filter((item) => item.id !== presetId),
      activePresetId: current.activePresetId === presetId ? undefined : current.activePresetId,
    }));
    setDeletePresetId(null);
    setEditingPreset((current) => (current?.id === presetId ? null : current));
    toast("预设已删除", "success");
  }

  function updateMapping(role: ComfyUiWorkflowNodeMapping["role"], patch: Partial<ComfyUiWorkflowNodeMapping>) {
    setSettings((current) => {
      const currentMappings = getNodeMappings(current, activePlatform);
      const existing = currentMappings.find((item) => item.role === role) ?? { role, nodeId: "", field: "", nodeType: "" };
      const nextEntry = { ...existing, ...patch };
      const nextMappings = [
        ...currentMappings.filter((item) => item.role !== role),
        nextEntry,
      ].sort((a, b) => {
        const order = { prompt: 0, refImage: 1, output: 2 };
        return order[a.role] - order[b.role];
      });
      return setNodeMappingsForPlatform(current, activePlatform, nextMappings);
    });
  }

  function saveCurrentAsPreset() {
    if (!currentWorkflow.workflowId.trim()) {
      toast("请先填写并确认当前工作流", "error");
      return;
    }

    const preset: ComfyUiWorkflowPreset = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: currentWorkflow.workflowName || `${COMFY_UI_PLATFORM_OPTIONS.find((item) => item.key === activePlatform)?.label || "ComfyUI"} 工作流`,
      description: "从当前平台配置保存的工作流预设",
      tags: [activePlatform === "thirdparty" ? "第三方算力" : activePlatform === "liblib" ? "LiblibAI" : "RunningHub", "自定义"],
      runs: "0",
      platform: activePlatform,
      workflowId: currentWorkflow.workflowId,
      nodeMappings: currentNodeMappings,
    };

    setSettings((current) => ({
      ...current,
      customPresets: [...current.customPresets, preset],
      activePresetId: preset.id,
    }));
    setEditingPreset(preset);
    toast("已保存为自定义工作流", "success");
  }

  if (!ready) {
    return (
      <div className="flex h-screen bg-[#0A0A0A]">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center">
          <Loader className="h-6 w-6 animate-spin text-[var(--gold-primary)]" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0A0A]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1160px] px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--gold-primary)]/10">
                <Zap className="h-5 w-5 text-[var(--gold-primary)]" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-serif text-xl font-semibold text-[var(--text-primary)]">ComfyUI 工作流</h1>
                  <span className="rounded bg-[var(--gold-primary)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--gold-primary)]">NEW</span>
                </div>
                <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">接驳 RunningHub / LiblibAI / 第三方算力，多服务器并行生成</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/comfyui/guide" className="flex items-center gap-2 border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)]/30 hover:text-[var(--gold-primary)]">
                <BookOpen className="h-3.5 w-3.5" />
                操作指南
              </Link>

              <button type="button" onClick={testPlatformConnection} disabled={testingConnection || checkingServerId !== null} className="flex cursor-pointer items-center gap-2 border border-[var(--gold-primary)] px-4 py-2 text-sm text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/10 disabled:opacity-50">
                {testingConnection ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                测试连接
              </button>

              <button type="button" onClick={saveConfig} disabled={saving} className="flex cursor-pointer items-center gap-2 bg-[var(--gold-primary)] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:brightness-110 disabled:opacity-50">
                {saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                保存配置
              </button>
            </div>
          </div>

          <div className="h-px bg-[var(--border-default)]" />

          <div className="flex border-b border-[var(--border-default)]">
            {COMFY_UI_PLATFORM_OPTIONS.map((option) => (
              <button key={option.key} type="button" onClick={() => setSettings((current) => ({ ...current, activePlatform: option.key }))} className={`relative cursor-pointer px-6 py-3 text-sm transition-colors ${activePlatform === option.key ? "font-semibold text-[var(--gold-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
                {option.label}
                {activePlatform === option.key ? <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--gold-primary)]" /> : null}
              </button>
            ))}
          </div>

          {!isThirdParty ? (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <label className="text-[13px] font-semibold text-[var(--text-primary)]">API Key</label>
                <span className="text-xs text-[var(--text-muted)]">({activePlatform === "runninghub" ? "RunningHub" : "LiblibAI"} 平台密钥)</span>
              </div>
              <div className="relative">
                <input type={showApiKey ? "text" : "password"} value={currentApiKey} onChange={(event) => setSettings((current) => setApiKeyForPlatform(current, activePlatform, event.target.value))} placeholder="sk-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="h-11 w-full border border-[var(--border-default)] bg-[var(--bg-panel)] px-4 pr-10 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--gold-primary)]/50" />
                <button type="button" onClick={() => setShowApiKey((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 border border-[var(--gold-primary)]/20 bg-[var(--gold-primary)]/5 px-4 py-3 text-[13px] text-[var(--text-secondary)]">💡 第三方算力模式直连 ComfyUI 服务器，无需 API Key。请在下方添加服务器连接。</div>
          )}

          {isThirdParty ? (
            <>
              <div className="my-6 h-px bg-[var(--border-default)]" />
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">服务器管理</h2>
                  <span className="text-xs text-green-400">当前并发：{onlineCount} 台服务器在线</span>
                </div>
                <button type="button" onClick={checkAllServers} disabled={bulkProgress !== null} className="flex cursor-pointer items-center gap-1.5 border border-[var(--border-default)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                  {bulkProgress ? <Loader className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                  {bulkProgress ? `${bulkProgress.current}/${bulkProgress.total}` : "全部测试"}
                </button>
              </div>
              <p className="mb-4 text-xs text-[var(--text-muted)]">每台服务器支持 1 路并发，添加更多服务器以提升并行生成能力</p>

              <div className="grid grid-cols-[1fr_2fr_80px_120px] gap-4 bg-[var(--bg-panel)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                <span>名称</span>
                <span>服务器地址</span>
                <span>状态 / 延迟</span>
                <span>操作</span>
              </div>

              {servers.length === 0 ? (
                <div className="border border-[var(--border-default)] py-12 text-center text-sm text-[var(--text-muted)]">
                  <p>暂无服务器</p>
                  <p className="mt-1 text-xs">点击下方按钮添加你的第一台 ComfyUI 服务器</p>
                </div>
              ) : (
                servers.map((server) => {
                  const state = serverStates[server.id];
                  const statusLabel = state?.status === "online" ? "在线" : state?.status === "testing" ? "测试中" : state?.status === "error" ? "错误" : "离线";
                  const statusClass = state?.status === "online" ? "text-green-400" : state?.status === "testing" ? "text-yellow-400" : "text-red-400";
                  return (
                    <div key={server.id} className="grid grid-cols-[1fr_2fr_80px_120px] items-center gap-4 border border-[var(--border-default)] px-4 py-3">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">{server.name}</span>
                      <span className="truncate text-xs text-[var(--text-secondary)]">{server.url}</span>
                      <span className="flex items-center gap-1.5">
                        {state?.status === "testing" ? <Loader className="h-3 w-3 animate-spin text-yellow-400" /> : <span className={`inline-block h-2 w-2 rounded-full ${state?.status === "online" ? "bg-green-400" : state?.status === "error" ? "bg-red-500" : "bg-red-400"}`} />}
                        <span className={`text-xs font-medium ${statusClass}`}>{statusLabel}</span>
                        {state?.latencyMs ? <span className="ml-1 text-[10px] text-[var(--text-muted)]">{state.latencyMs}ms</span> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <button type="button" onClick={() => checkServer(server)} disabled={checkingServerId === server.id} className="border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)] disabled:opacity-50">测试</button>
                        {deleteServerId === server.id ? (
                          <>
                            <button type="button" onClick={() => removeServer(server.id)} className="border border-red-400/40 bg-red-400/20 px-2 py-1 text-xs font-semibold text-red-400">确认</button>
                            <button type="button" onClick={() => setDeleteServerId(null)} className="border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)]">取消</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setDeleteServerId(server.id)} className="border border-[var(--border-default)] px-2 py-1 text-xs text-red-400 transition hover:border-red-400/30 hover:bg-red-400/10">删除</button>
                        )}
                      </span>
                    </div>
                  );
                })
              )}

              {addingServer ? (
                <div className="mt-1 border border-[var(--gold-primary)]/30 bg-[var(--bg-panel)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">添加新服务器</h3>
                  <div className="flex items-end gap-3">
                    <div className="w-48 flex-shrink-0">
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">名称</label>
                      <input value={newServerName} onChange={(event) => setNewServerName(event.target.value)} placeholder="例: AutoDL-4090" className="h-8 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">服务器地址</label>
                      <input value={newServerAddress} onChange={(event) => setNewServerAddress(event.target.value)} placeholder="http://ip:port 或 https://domain:port" className="h-8 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50" />
                    </div>
                    <button type="button" onClick={addServer} className="h-8 flex-shrink-0 bg-[var(--gold-primary)] px-4 text-xs font-semibold text-[#0A0A0A] transition hover:brightness-110">保存并测试</button>
                    <button type="button" onClick={() => { setAddingServer(false); setNewServerName(""); setNewServerAddress(""); }} className="h-8 flex-shrink-0 border border-[var(--border-default)] px-3 text-xs text-[var(--text-secondary)]">取消</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAddingServer(true)} className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--gold-primary)]/30 bg-[var(--gold-primary)]/5 py-3 text-sm text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/10">
                  <Plus className="h-4 w-4" />
                  添加服务器
                </button>
              )}
            </>
          ) : null}

          <div className="my-6 h-px bg-[var(--border-default)]" />

          <div className="mb-6">
            <h2 className="mb-1 text-base font-semibold text-[var(--text-primary)]">工作流配置</h2>
            <p className="mb-4 text-xs text-[var(--text-muted)]">{isThirdParty ? "上传工作流 JSON 或填写本地 ComfyUI 工作流路径" : "填写工作流 ID，或从工作流 URL 中自动解析"}</p>
            <label className="mb-2 block text-[13px] font-semibold text-[var(--text-primary)]">工作流 {isThirdParty ? "JSON / 路径" : "ID / URL"}</label>
            <div className="relative">
              <input value={currentWorkflow.workflowId} onChange={(event) => applyWorkflowIdInput(event.target.value)} placeholder={isThirdParty ? "粘贴工作流 JSON 或填写工作流文件路径" : "https://www.runninghub.cn/task/xxxx 或直接输入 task_id"} className="h-11 w-full border border-[var(--border-default)] bg-[var(--bg-panel)] px-4 pr-28 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--gold-primary)]/50" />
              {!isThirdParty ? <button type="button" onClick={parseWorkflowUrl} className="absolute right-2 top-1/2 -translate-y-1/2 bg-[var(--gold-primary)]/15 px-3 py-1.5 text-xs text-[var(--gold-primary)] transition hover:bg-[var(--gold-primary)]/25">解析 URL</button> : null}
            </div>
            {currentWorkflow.verified ? (
              <div className="mt-3 flex items-center gap-2 bg-green-400/5 px-4 py-2.5 text-xs text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  工作流已验证：{currentWorkflow.workflowName || currentWorkflow.workflowId}
                  {currentWorkflow.nodeCount ? ` | ${currentWorkflow.nodeCount} 个节点` : ""}
                  {currentWorkflow.inputCount ? ` | ${currentWorkflow.inputCount} 个输入参数` : ""}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]">
              <Upload className="h-4 w-4" />
              导入工作流
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importWorkflowFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={autoDetectMappings}
              disabled={detectingMappings}
              className="flex cursor-pointer items-center gap-2 border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {detectingMappings ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              自动检测
            </button>
            <button
              type="button"
              onClick={saveCurrentAsPreset}
              className="flex cursor-pointer items-center gap-2 border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]"
            >
              <Plus className="h-4 w-4" />
              保存为预设工作流
            </button>
          </div>

          <div className="mb-6">
            <div className="mb-1 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">节点映射</h2>
              <span className="text-xs text-[var(--text-muted)]">自动检测可先生成通用模板，再按平台微调</span>
            </div>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
              将工作流中的输入输出节点映射到「提示词 / 参考图 / 输出结果」。官方平台一般只需确认 3 个关键节点。
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              <MappingCard
                title="提示词节点"
                description="文本提示词输入节点，例如 CLIPTextEncode / PromptInput"
                accent="gold"
                value={currentNodeMappings.find((item) => item.role === "prompt")}
                onChange={(patch) => updateMapping("prompt", patch)}
              />
              <MappingCard
                title="参考图节点"
                description="图像或首帧输入节点，例如 LoadImage / ImageInput"
                accent="blue"
                value={currentNodeMappings.find((item) => item.role === "refImage")}
                onChange={(patch) => updateMapping("refImage", patch)}
              />
              <MappingCard
                title="输出节点"
                description="图片或视频输出节点，例如 SaveImage / SaveVideo"
                accent="green"
                value={currentNodeMappings.find((item) => item.role === "output")}
                onChange={(patch) => updateMapping("output", patch)}
              />
            </div>
          </div>

          <div className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">预设工作流</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">支持官方预设、自定义预设、导入导出和一键套用。</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]">
                <Upload className="h-3.5 w-3.5" />
                导入预设工作流
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importPresetFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {presets.map((preset) => {
                const isCustom = settings.customPresets.some((item) => item.id === preset.id);
                const isActivePreset = settings.activePresetId === preset.id;
                const platformLabel = COMFY_UI_PLATFORM_OPTIONS.find((item) => item.key === preset.platform)?.label || preset.platform;
                return (
                  <div
                    key={preset.id}
                    className={`border p-4 transition ${isActivePreset ? "border-[var(--gold-primary)] bg-[var(--gold-primary)]/6 shadow-[0_0_0_1px_rgba(201,163,92,0.16)]" : "border-[var(--border-default)] bg-[var(--bg-panel)]"}`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{preset.name}</h3>
                          {isCustom ? (
                            <span className="rounded border border-[var(--gold-primary)]/30 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--gold-primary)]">
                              自定义
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[var(--text-secondary)]">{preset.description}</p>
                      </div>
                      <span className="rounded bg-[var(--bg-surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{platformLabel}</span>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      {preset.tags.map((tag) => (
                        <span key={`${preset.id}-${tag}`} className="rounded border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="space-y-1 text-[11px] text-[var(--text-muted)]">
                      <div>工作流 ID: {preset.workflowId || "待填写"}</div>
                      <div>节点映射: {preset.nodeMappings.length} 项</div>
                      <div>使用次数: {preset.runs}</div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="flex cursor-pointer items-center gap-1.5 bg-[var(--gold-primary)] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:brightness-110"
                      >
                        <Check className="h-3.5 w-3.5" />
                        套用
                      </button>
                      <button
                        type="button"
                        onClick={() => clonePreset(preset)}
                        className="flex cursor-pointer items-center gap-1.5 border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => exportPreset(preset)}
                        className="flex cursor-pointer items-center gap-1.5 border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        导出
                      </button>
                      {isCustom ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingPreset({ ...preset })}
                            className="flex cursor-pointer items-center gap-1.5 border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            编辑
                          </button>
                          {deletePresetId === preset.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => removePreset(preset.id)}
                                className="flex cursor-pointer items-center gap-1.5 border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                确认删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletePresetId(null)}
                                className="border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeletePresetId(preset.id)}
                              className="flex cursor-pointer items-center gap-1.5 border border-[var(--border-default)] px-3 py-1.5 text-xs text-red-400 transition hover:border-red-400/30 hover:bg-red-400/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-[var(--border-default)] bg-[var(--bg-panel)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>配置文件：{configFile || "未保存到磁盘"}</span>
              <span>当前服务器：{isThirdParty ? servers.find((item) => item.id === activeServerId)?.name || "未选择" : "云端平台模式"}</span>
            </div>
          </div>
        </div>
      </main>

      {editingPreset ? (
        <PresetModal
          preset={editingPreset}
          onClose={() => setEditingPreset(null)}
          onSave={saveEditedPreset}
        />
      ) : null}
    </div>
  );
}

type MappingCardProps = {
  title: string;
  description: string;
  accent: "gold" | "blue" | "green";
  value?: ComfyUiWorkflowNodeMapping;
  onChange: (patch: Partial<ComfyUiWorkflowNodeMapping>) => void;
};

function MappingCard({ title, description, accent, value, onChange }: MappingCardProps) {
  const accentClass =
    accent === "blue"
      ? "border-blue-400/20 bg-blue-400/5"
      : accent === "green"
      ? "border-green-400/20 bg-green-400/5"
      : "border-[var(--gold-primary)]/20 bg-[var(--gold-primary)]/5";

  return (
    <div className={`border p-4 ${accentClass}`}>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-[var(--text-secondary)]">节点 ID</label>
          <input
            value={value?.nodeId || ""}
            onChange={(event) => onChange({ nodeId: event.target.value })}
            placeholder="例如 6 / 12 / output_node"
            className="h-9 w-full border border-[var(--border-default)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">字段名</label>
            <input
              value={value?.field || ""}
              onChange={(event) => onChange({ field: event.target.value })}
              placeholder="text / image / images / video"
              className="h-9 w-full border border-[var(--border-default)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">节点类型</label>
            <input
              value={value?.nodeType || ""}
              onChange={(event) => onChange({ nodeType: event.target.value })}
              placeholder="CLIPTextEncode / SaveImage"
              className="h-9 w-full border border-[var(--border-default)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

type PresetModalProps = {
  preset: ComfyUiWorkflowPreset;
  onClose: () => void;
  onSave: (preset: ComfyUiWorkflowPreset) => void;
};

function PresetModal({ preset, onClose, onSave }: PresetModalProps) {
  const [draft, setDraft] = useState<ComfyUiWorkflowPreset>(preset);

  function updateMapping(role: ComfyUiWorkflowNodeMapping["role"], patch: Partial<ComfyUiWorkflowNodeMapping>) {
    setDraft((current) => {
      const existing = current.nodeMappings.find((item) => item.role === role) ?? { role, nodeId: "", field: "", nodeType: "" };
      const next = [...current.nodeMappings.filter((item) => item.role !== role), { ...existing, ...patch }];
      const order = { prompt: 0, refImage: 1, output: 2 };
      next.sort((a, b) => order[a.role] - order[b.role]);
      return { ...current, nodeMappings: next };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-[var(--border-default)] bg-[var(--bg-panel)] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">编辑工作流预设</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">可调整平台、工作流 ID 和 3 个关键节点映射。</p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">名称</label>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="h-10 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">平台</label>
            <select
              value={draft.platform}
              onChange={(event) =>
                setDraft((current) => ({ ...current, platform: event.target.value as ComfyUiPlatformKey }))
              }
              className="h-10 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            >
              {COMFY_UI_PLATFORM_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-[var(--text-secondary)]">描述</label>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            rows={3}
            className="w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">标签（逗号分隔）</label>
            <input
              value={draft.tags.join(", ")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  tags: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                }))
              }
              className="h-10 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">工作流 ID / URL</label>
            <input
              value={draft.workflowId}
              onChange={(event) => setDraft((current) => ({ ...current, workflowId: event.target.value }))}
              className="h-10 w-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50"
            />
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <MappingCard
            title="提示词节点"
            description="用于写入 prompt 文本"
            accent="gold"
            value={draft.nodeMappings.find((item) => item.role === "prompt")}
            onChange={(patch) => updateMapping("prompt", patch)}
          />
          <MappingCard
            title="参考图节点"
            description="用于写入 image / 首帧"
            accent="blue"
            value={draft.nodeMappings.find((item) => item.role === "refImage")}
            onChange={(patch) => updateMapping("refImage", patch)}
          />
          <MappingCard
            title="输出节点"
            description="用于读取图片 / 视频结果"
            accent="green"
            value={draft.nodeMappings.find((item) => item.role === "output")}
            onChange={(patch) => updateMapping("output", patch)}
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--gold-primary)] hover:text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="bg-[var(--gold-primary)] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:brightness-110"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
