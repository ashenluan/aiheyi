"use client";

import type { ReactNode } from "react";

import type { LicenseStatus } from "@/app/lib/license/types";
import { BRAND_NAME } from "@/app/lib/brand";
import DefaultLicenseScreen from "./DefaultLicenseScreen";
import { useLicenseStatus } from "./useLicenseStatus";

interface LicenseGuardProps {
  children: ReactNode | ((status: LicenseStatus) => ReactNode);
  title?: string;
  endpoint?: string;
  maxAttempts?: number;
  loadingFallback?: ReactNode;
  renderLocked?: (state: ReturnType<typeof useLicenseStatus>) => ReactNode;
}

export default function LicenseGuard({
  children,
  title = BRAND_NAME,
  endpoint = "/api/license",
  maxAttempts = 5,
  loadingFallback,
  renderLocked,
}: LicenseGuardProps) {
  const license = useLicenseStatus({
    endpoint,
    maxAttempts,
  });

  if (license.loading) {
    return loadingFallback ? (
      <>{loadingFallback}</>
    ) : (
      <div className="h-full flex items-center justify-center bg-[var(--bg-page)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[var(--text-secondary)] text-sm">正在检查授权...</span>
        </div>
      </div>
    );
  }

  if (license.status?.activated) {
    return (
      <>
        {typeof children === "function" ? children(license.status) : children}
      </>
    );
  }

  return renderLocked ? (
    <>{renderLocked(license)}</>
  ) : (
    <DefaultLicenseScreen
      title={title}
      status={license.status}
      activationCode={license.activationCode}
      onActivationCodeChange={license.setActivationCode}
      onSubmit={license.submit}
      submitting={license.submitting}
      attempts={license.attempts}
      maxAttempts={license.maxAttempts}
      message={license.message}
    />
  );
}
