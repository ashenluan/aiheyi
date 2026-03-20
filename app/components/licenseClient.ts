import type { LicenseStatus } from "@/app/lib/license/types";

export type LicenseFetcher = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function createUnavailableStatus(
  error = "无法连接授权服务",
  now = new Date(),
): LicenseStatus {
  return {
    activated: false,
    state: "error",
    machineCode: "获取失败",
    error,
    checkedAt: now.toISOString(),
  };
}

export async function fetchLicenseStatus(
  endpoint: string,
  fetcher: LicenseFetcher = fetch,
): Promise<LicenseStatus> {
  const response = await fetcher(endpoint, { method: "GET" });
  if (!response.ok) {
    throw new Error("授权接口不可用");
  }

  return readJson<LicenseStatus>(response);
}

export async function submitActivationCode(
  endpoint: string,
  activationCode: string,
  fetcher: LicenseFetcher = fetch,
): Promise<LicenseStatus> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      activationCode: activationCode.trim(),
    }),
  });

  return readJson<LicenseStatus>(response);
}
