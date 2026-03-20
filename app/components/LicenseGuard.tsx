"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { LicenseStatus } from "@/app/lib/license/types";

interface LicenseGuardProps {
  children: ReactNode;
  title?: string;
  endpoint?: string;
  maxAttempts?: number;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export default function LicenseGuard({
  children,
  title = "FEICAI STUDIO",
  endpoint = "/api/license",
  maxAttempts = 5,
}: LicenseGuardProps) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (!response.ok) {
        throw new Error("授权接口不可用");
      }

      setStatus(await readJson<LicenseStatus>(response));
    } catch {
      setStatus({
        activated: false,
        state: "error",
        machineCode: "获取失败",
        error: "无法连接授权服务",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const submit = useCallback(async () => {
    if (!activationCode.trim() || submitting) {
      return;
    }

    if (attempts >= maxAttempts) {
      setMessage("尝试次数过多，请稍后再试");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activationCode: activationCode.trim(),
        }),
      });

      const nextStatus = await readJson<LicenseStatus>(response);
      setStatus(nextStatus);

      if (!nextStatus.activated) {
        setAttempts((current: number) => current + 1);
        setMessage(nextStatus.error ?? "激活失败");
      }
    } catch {
      setAttempts((current: number) => current + 1);
      setMessage("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [activationCode, attempts, endpoint, maxAttempts, submitting]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg-page)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[var(--text-secondary)] text-sm">正在检查授权...</span>
        </div>
      </div>
    );
  }

  if (status?.activated) {
    return <>{children}</>;
  }

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-page)] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-wider text-[var(--gold-primary)] font-serif mb-1">
            {title}
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">软件授权验证</p>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-6 space-y-6">
          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-2 tracking-wider uppercase">
              本机机器码
            </label>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[var(--bg-page)] border border-[var(--border-default)] rounded px-3 py-2.5 font-mono text-sm text-[var(--gold-primary)] tracking-widest select-all">
                {status?.machineCode ?? "—"}
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!status?.machineCode) {
                    return;
                  }

                  await navigator.clipboard.writeText(status.machineCode);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2_000);
                }}
                className="shrink-0 px-3 py-2.5 text-xs border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition-colors text-[var(--text-secondary)]"
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-tertiary)] mb-2 tracking-wider uppercase">
              输入激活码
            </label>

            <input
              type="text"
              value={activationCode}
              onChange={(event) => {
                setActivationCode(event.target.value);
                setMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit();
                }
              }}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXXXXXX"
              disabled={submitting}
              className="w-full bg-[var(--bg-page)] border border-[var(--border-default)] rounded px-3 py-2.5 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold-primary)] transition-colors tracking-wider"
            />
          </div>

          {(message || status?.error) && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {message || status?.error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!activationCode.trim() || submitting || attempts >= maxAttempts}
            className="w-full py-2.5 rounded text-sm font-medium tracking-wider transition-all bg-[var(--gold-primary)] text-[var(--bg-page)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "验证中..." : "激活"}
          </button>

          {attempts > 0 && attempts < maxAttempts && (
            <p className="text-center text-xs text-[var(--text-muted)]">
              已尝试 {attempts} 次，剩余 {maxAttempts - attempts} 次
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
