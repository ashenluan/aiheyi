"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "../components/Sidebar";
import { useToast } from "../components/Toast";
import { comfyUiExampleWorkflow } from "@/app/lib/comfyui/sampleWorkflow";
import type {
  ComfyUiConfig,
  ComfyUiServer,
  ComfyUiStatus,
  ComfyUiSubmitResponse,
} from "@/app/lib/comfyui/types";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Globe,
  Loader,
  Plus,
  Save,
  Send,
  Server,
  SquareTerminal,
  Trash2,
  Workflow,
} from "lucide-react";

const DEFAULT_WORKFLOW_TEXT = JSON.stringify(comfyUiExampleWorkflow, null, 2);
const WORKFLOW_STORAGE_KEY = "feicai-comfyui-workflow";

function createServerDraft(index: number): ComfyUiServer {
  return {
    id: `comfy-local-${Date.now()}-${index}`,
    name: `ComfyUI ${index + 1}`,
    url: "http://127.0.0.1:8188",
    note: "",
    enabled: true,
  };
}

export default function ComfyUiPage() {
  const { toast } = useToast();
  const [servers, setServers] = useState<ComfyUiServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [configFile, setConfigFile] = useState("");
  const [statuses, setStatuses] = useState<Record<string, ComfyUiStatus>>({});
  const [workflowText, setWorkflowText] = useState(DEFAULT_WORKFLOW_TEXT);
  const [submitResult, setSubmitResult] = useState<ComfyUiSubmitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) ?? servers[0] ?? null,
    [servers, activeServerId]
  );

  const onlineCount = useMemo(
    () => Object.values(statuses).filter((status) => status.online).length,
    [statuses]
  );

  useEffect(() => {
    const cachedWorkflow = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (cachedWorkflow) setWorkflowText(cachedWorkflow);
  }, []);

  useEffect(() => {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, workflowText);
  }, [workflowText]);

  async function loadConfig() {
    setLoading(true);
    try {
      const response = await fetch("/api/comfyui/servers", { cache: "no-store" });
      const data = await response.json();
      const config = data as ComfyUiConfig & { configFile?: string };
      setServers(config.servers || []);
      setActiveServerId(config.activeServerId ?? config.servers?.[0]?.id ?? null);
      setConfigFile(config.configFile || "");
      setStatuses({});
    } catch {
      toast("读取 ComfyUI 配置失败", "error");
      setServers([createServerDraft(0)]);
      setActiveServerId(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  async function saveConfig() {
    setSaving(true);
    try {
      const response = await fetch("/api/comfyui/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers, activeServerId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setServers(data.servers || []);
      setActiveServerId(data.activeServerId ?? data.servers?.[0]?.id ?? null);
      setConfigFile(data.configFile || "");
      toast("ComfyUI 服务器配置已保存", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  function updateServer(serverId: string, patch: Partial<ComfyUiServer>) {
    setServers((current) =>
      current.map((server) => (server.id === serverId ? { ...server, ...patch } : server))
    );
  }

  function addServer() {
    setServers((current) => {
      const next = [...current, createServerDraft(current.length)];
      if (!activeServerId) setActiveServerId(next[0].id);
      return next;
    });
  }

  function removeServer(serverId: string) {
    setServers((current) => {
      if (current.length === 1) {
        toast("至少保留一个 ComfyUI 服务器", "info");
        return current;
      }
      const next = current.filter((server) => server.id !== serverId);
      if (activeServerId === serverId) {
        setActiveServerId(next[0]?.id ?? null);
      }
      setStatuses((statusMap) => {
        const cloned = { ...statusMap };
        delete cloned[serverId];
        return cloned;
      });
      return next;
    });
  }

  async function checkServer(server: ComfyUiServer) {
    setCheckingId(server.id);
    try {
      const response = await fetch("/api/comfyui/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: server.id,
          url: server.url,
          name: server.name,
        }),
      });
      const data = (await response.json()) as ComfyUiStatus & { error?: string };
      setStatuses((current) => ({ ...current, [server.id]: data }));
      if (response.ok) {
        toast(`${server.name} 在线，可继续提交工作流`, "success");
      } else {
        toast(data.error || `${server.name} 当前不可用`, "error");
      }
    } catch {
      toast(`无法连接 ${server.name}`, "error");
    } finally {
      setCheckingId(null);
    }
  }

  async function checkAllServers() {
    for (const server of servers) {
      // eslint-disable-next-line no-await-in-loop
      await checkServer(server);
    }
  }

  async function submitWorkflow() {
    if (!activeServer) {
      toast("请先配置 ComfyUI 服务器", "error");
      return;
    }

    try {
      JSON.parse(workflowText);
    } catch {
      toast("工作流 JSON 格式不合法，请先修正", "error");
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
          workflow: workflowText,
        }),
      });
      const data = (await response.json()) as ComfyUiSubmitResponse;
      setSubmitResult(data);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "工作流提交失败");
      }
      toast(`工作流已提交到 ${activeServer.name}`, "success");
      await checkServer(activeServer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作流提交失败";
      toast(message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 flex flex-col gap-8 p-8 px-10 overflow-auto">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-normal text-[var(--text-secondary)]">节点工作流接入</span>
            <h1 className="font-serif text-[40px] font-medium text-[var(--text-primary)]">ComfyUI 工作流</h1>
            <p className="max-w-[820px] text-[14px] leading-relaxed text-[var(--text-secondary)]">
              这里用于管理多个 ComfyUI 服务、探测在线状态，并把自定义 workflow JSON 直接投递到 `/prompt` 队列里。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/comfyui/guide"
              className="flex items-center gap-2 px-4 py-2 border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition"
            >
              <SquareTerminal size={14} />
              接入指南
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2 px-4 py-2 bg-[var(--gold-primary)] text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition"
            >
              打开设置
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {[
            {
              label: "已配置服务器",
              value: String(servers.length || 0),
              icon: Server,
              detail: activeServer ? `当前激活: ${activeServer.name}` : "未选择激活服务器",
            },
            {
              label: "在线服务器",
              value: String(onlineCount),
              icon: CheckCircle2,
              detail: onlineCount > 0 ? "可直接提交工作流" : "建议先做状态探测",
            },
            {
              label: "配置文件",
              value: configFile ? "已落盘" : "未落盘",
              icon: Cpu,
              detail: configFile || "将保存到程序根目录",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex flex-col gap-4 border border-[var(--border-default)] p-6">
                <span className="text-[13px] text-[var(--text-secondary)]">{item.label}</span>
                <span className="font-serif text-[36px] text-[var(--text-primary)]">{item.value}</span>
                <div className="flex items-center gap-2">
                  <Icon size={14} className="text-[var(--gold-primary)]" />
                  <span className="text-[12px] text-[var(--text-secondary)] truncate">{item.detail}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[1.05fr_1.2fr] gap-6 items-start">
          <section className="flex flex-col gap-4 border border-[var(--border-default)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Globe size={18} className="text-[var(--gold-primary)]" />
                <div>
                  <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">ComfyUI 节点服务器</h2>
                  <p className="text-[12px] text-[var(--text-secondary)]">支持多服务切换，默认推荐接本机 `127.0.0.1:8188`。</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={checkAllServers}
                  disabled={loading || checkingId !== null}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                >
                  {checkingId ? <Loader size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                  全部探测
                </button>
                <button
                  onClick={saveConfig}
                  disabled={loading || saving}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40"
                >
                  {saving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                  保存配置
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader size={20} className="animate-spin text-[var(--gold-primary)]" />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {servers.map((server) => {
                  const status = statuses[server.id];
                  const isActive = activeServerId === server.id;
                  const isChecking = checkingId === server.id;
                  return (
                    <div
                      key={server.id}
                      className={`flex flex-col gap-4 border p-4 transition ${
                        isActive ? "border-[var(--gold-primary)] bg-[#C9A96208]" : "border-[var(--border-default)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)] cursor-pointer">
                          <input
                            type="radio"
                            name="active-comfy-server"
                            checked={isActive}
                            onChange={() => setActiveServerId(server.id)}
                            className="accent-[var(--gold-primary)]"
                          />
                          设为激活节点
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => checkServer(server)}
                            disabled={isChecking}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                          >
                            {isChecking ? <Loader size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                            探测
                          </button>
                          <button
                            onClick={() => removeServer(server.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-red-500/30 text-[11px] text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                          >
                            <Trash2 size={11} />
                            删除
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] text-[var(--text-muted)]">显示名称</label>
                          <input
                            value={server.name}
                            onChange={(event) => updateServer(server.id, { name: event.target.value })}
                            className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] text-[var(--text-muted)]">状态备注</label>
                          <input
                            value={server.note || ""}
                            onChange={(event) => updateServer(server.id, { note: event.target.value })}
                            placeholder="如：3090 工作站 / 云端节点"
                            className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] text-[var(--text-muted)]">服务地址</label>
                        <input
                          value={server.url}
                          onChange={(event) => updateServer(server.id, { url: event.target.value })}
                          placeholder="http://127.0.0.1:8188"
                          className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-[var(--text-muted)]">在线状态</span>
                          <span className={`text-[12px] font-medium ${status?.online ? "text-emerald-400" : "text-[var(--text-secondary)]"}`}>
                            {status ? (status.online ? "在线" : "离线") : "未探测"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-[var(--text-muted)]">延迟</span>
                          <span className="text-[12px] text-[var(--text-primary)]">{status ? `${status.latencyMs} ms` : "--"}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-[var(--text-muted)]">队列</span>
                          <span className="text-[12px] text-[var(--text-primary)]">
                            {status ? `${status.queueRunning}/${status.queuePending}` : "--/--"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-[var(--text-muted)]">节点数</span>
                          <span className="text-[12px] text-[var(--text-primary)]">{status ? status.nodeCount : "--"}</span>
                        </div>
                      </div>

                      {(status?.deviceName || status?.comfyVersion || status?.error || server.note) && (
                        <div className="flex flex-col gap-1.5 px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)]">
                          {server.note && <span className="text-[11px] text-[var(--text-secondary)]">备注：{server.note}</span>}
                          {status?.deviceName && <span className="text-[11px] text-[var(--text-secondary)]">设备：{status.deviceName}</span>}
                          {status?.comfyVersion && <span className="text-[11px] text-[var(--text-secondary)]">版本：{status.comfyVersion}</span>}
                          {status?.error && <span className="text-[11px] text-red-400">错误：{status.error}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={addServer}
                  className="flex items-center justify-center gap-2 py-3 border border-dashed border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Plus size={14} />
                  新增 ComfyUI 服务器
                </button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 border border-[var(--border-default)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Workflow size={18} className="text-[var(--gold-primary)]" />
                <div>
                  <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">工作流提交面板</h2>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    当前目标：{activeServer ? `${activeServer.name} · ${activeServer.url}` : "未选择服务器"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWorkflowText(DEFAULT_WORKFLOW_TEXT)}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <SquareTerminal size={12} />
                  载入示例
                </button>
                <button
                  onClick={submitWorkflow}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40"
                >
                  {submitting ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                  提交到队列
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-medium text-[var(--text-secondary)]">Workflow JSON</label>
              <textarea
                value={workflowText}
                onChange={(event) => setWorkflowText(event.target.value)}
                spellCheck={false}
                className="min-h-[520px] resize-y bg-[#0D0D0D] border border-[var(--border-default)] px-4 py-3 font-mono text-[12px] leading-6 text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
              />
              <div className="flex items-start gap-2 px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)]">
                <Cpu size={13} className="text-[var(--gold-primary)] mt-0.5 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    这个示例工作流是最小文本生图骨架，第一次测试时记得把 `ckpt_name` 改成你本地 ComfyUI 真实存在的模型名。
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    如果你已经有成熟 workflow，直接把 API 导出的 JSON 整段贴进来即可。
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="border border-[var(--border-default)] p-4">
                <span className="text-[11px] text-[var(--text-muted)]">推荐流程</span>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  先做状态探测，再提交示例 workflow，确认 `/prompt` 可写入后再接更复杂的节点图。
                </p>
              </div>
              <div className="border border-[var(--border-default)] p-4">
                <span className="text-[11px] text-[var(--text-muted)]">适合接入</span>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  本地 AIGC 工作站、远程 GPU 节点、已有的 ComfyUI API 网关。
                </p>
              </div>
              <div className="border border-[var(--border-default)] p-4">
                <span className="text-[11px] text-[var(--text-muted)]">下一步</span>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  接通后，可继续把提示词、参考图和分镜参数投递到 ComfyUI 编排链路。
                </p>
              </div>
            </div>

            {submitResult && (
              <div className="flex flex-col gap-3 border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className={submitResult.success ? "text-emerald-400" : "text-red-400"} />
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {submitResult.success ? "最近一次提交成功" : "最近一次提交失败"}
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)]">{submitResult.serverName}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)]">Prompt ID</span>
                    <p className="mt-1 font-mono text-[12px] text-[var(--text-primary)] break-all">
                      {submitResult.promptId || "--"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)]">Client ID</span>
                    <p className="mt-1 font-mono text-[12px] text-[var(--text-primary)] break-all">
                      {submitResult.clientId}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)]">节点数量</span>
                    <p className="mt-1 text-[12px] text-[var(--text-primary)]">{submitResult.workflowNodes}</p>
                  </div>
                </div>
                {submitResult.error && (
                  <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-400">
                    {submitResult.error}
                  </div>
                )}
                <pre className="max-h-[240px] overflow-auto bg-[#0D0D0D] px-4 py-3 text-[11px] leading-6 text-[var(--text-secondary)]">
                  {JSON.stringify(submitResult.rawResponse ?? submitResult, null, 2)}
                </pre>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
