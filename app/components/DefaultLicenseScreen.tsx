"use client";

import { useState } from "react";

import type { LicenseStatus } from "@/app/lib/license/types";

export interface DefaultLicenseScreenProps {
  title: string;
  status: LicenseStatus | null;
  activationCode: string;
  onActivationCodeChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  attempts: number;
  maxAttempts: number;
  message: string;
}

export default function DefaultLicenseScreen({
  title,
  status,
  activationCode,
  onActivationCodeChange,
  onSubmit,
  submitting,
  attempts,
  maxAttempts,
  message,
}: DefaultLicenseScreenProps) {
  const [copied, setCopied] = useState(false);

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
                  if (!status?.machineCode || !navigator.clipboard) {
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
                onActivationCodeChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onSubmit();
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
            onClick={() => void onSubmit()}
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
