"use client";

import { useMemo, useState } from "react";
import { CheckCheck, Loader, RefreshCw, Rocket } from "lucide-react";
import { useToast } from "@/app/components/Toast";
import type { HotUpdateStatus } from "@/app/lib/hotUpdate";

function formatCheckedAt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HotUpdateCard({ initialStatus }: { initialStatus: HotUpdateStatus }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<HotUpdateStatus>(initialStatus);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const metaBadges = useMemo(
    () => [
      "当前版本",
      `最近检查 ${formatCheckedAt(status.checkedAt)}`,
      status.hasUpdate ? `最新 ${status.latestVersion}` : `当前 ${status.currentVersion}`,
    ],
    [status],
  );

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      const res = await fetch("/api/hot-update?refresh=1", { cache: "no-store" });
      const data = (await res.json()) as HotUpdateStatus;
      if (!res.ok) throw new Error(data?.error || "检查更新失败");
      setStatus(data);
      if (data.error) {
        toast(`检查更新失败: ${data.error}`, "error");
        return;
      }
      toast(data.hasUpdate ? `发现新版本 ${data.latestVersion}` : "已是最新版本", data.hasUpdate ? "info" : "success");
    } catch (e) {
      toast(`检查更新失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setChecking(false);
    }
  }

  async function handleApplyUpdate() {
    if (!status.canUpdate) {
      toast("已是最新版本", "info");
      return;
    }

    if (!status.patchUrl) {
      toast("当前缺少补丁包地址，请先重新检查更新", "error");
      return;
    }

    setUpdating(true);
    try {
      const res = await fetch("/api/hot-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patchUrl: status.patchUrl,
          sha256: status.sha256,
          remoteVersion: status.latestVersion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "更新失败");
      toast(data.message || "更新完成！请重启应用使更新生效", "success");
      setStatus(data.status || status);
    } catch (e) {
      toast(`更新失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center gap-2 mb-3">
        <RefreshCw size={15} className="text-[var(--gold-primary)]" />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">热更新状态</span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] border rounded ${
            status.hasUpdate
              ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
              : "text-[var(--gold-primary)] border-[var(--gold-primary)]/30 bg-[var(--gold-transparent)]"
          }`}>
            {status.hasUpdate ? <Rocket size={12} /> : <CheckCheck size={12} />}
            {status.statusLabel}
          </span>
          <span className="text-[12px] text-[var(--text-muted)]">{status.hint}</span>
        </div>

        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{status.message}</p>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleCheckUpdate}
            disabled={checking || updating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-transparent)] hover:brightness-110 transition cursor-pointer rounded disabled:opacity-60 disabled:cursor-not-allowed"
            title="检查更新"
          >
            {checking ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {checking ? "检查中..." : status.primaryActionLabel}
          </button>
          <button
            onClick={handleApplyUpdate}
            disabled={checking || updating || !status.canUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title={status.canUpdate ? "一键更新" : "已是最新版本"}
          >
            {updating ? <Loader size={12} className="animate-spin" /> : <Rocket size={12} />}
            {updating ? "更新中..." : status.secondaryActionLabel}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
          {metaBadges.map((badge) => (
            <span key={badge} className="px-2 py-1 border border-[var(--border-default)]">
              {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
