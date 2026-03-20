"use client";

import { useCallback, useEffect, useState } from "react";

import type { LicenseStatus } from "@/app/lib/license/types";
import {
  createUnavailableStatus,
  fetchLicenseStatus,
  submitActivationCode,
} from "./licenseClient";

export interface UseLicenseStatusOptions {
  endpoint?: string;
  maxAttempts?: number;
}

export interface UseLicenseStatusResult {
  status: LicenseStatus | null;
  loading: boolean;
  submitting: boolean;
  activationCode: string;
  attempts: number;
  maxAttempts: number;
  message: string;
  refreshStatus: () => Promise<void>;
  submit: () => Promise<void>;
  setActivationCode: (value: string) => void;
}

export function useLicenseStatus({
  endpoint = "/api/license",
  maxAttempts = 5,
}: UseLicenseStatusOptions = {}): UseLicenseStatusResult {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activationCode, setActivationCodeState] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");

  const refreshStatus = useCallback(async () => {
    setLoading(true);

    try {
      setStatus(await fetchLicenseStatus(endpoint));
    } catch {
      setStatus(createUnavailableStatus());
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const setActivationCode = useCallback((value: string) => {
    setActivationCodeState(value);
    setMessage("");
  }, []);

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
      const nextStatus = await submitActivationCode(endpoint, activationCode);
      setStatus(nextStatus);

      if (!nextStatus.activated) {
        setAttempts((current) => current + 1);
        setMessage(nextStatus.error ?? "激活失败");
      }
    } catch {
      setAttempts((current) => current + 1);
      setMessage("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [activationCode, attempts, endpoint, maxAttempts, submitting]);

  return {
    status,
    loading,
    submitting,
    activationCode,
    attempts,
    maxAttempts,
    message,
    refreshStatus,
    submit,
    setActivationCode,
  };
}
