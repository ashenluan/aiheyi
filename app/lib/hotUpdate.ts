import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { getChangelogSummary } from "@/app/lib/changelog";
import { resolveProjectRoot } from "@/app/lib/runtimePaths";

const DEFAULT_UPDATE_MANIFEST_URL = "https://feicai-update.oss-cn-hangzhou.aliyuncs.com/latest.json";
const ALLOWED_PATCH_HOST_SUFFIX = ".aliyuncs.com";
const UNKNOWN_CURRENT_VERSION = "未知（首次检查）";

export interface HotUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  localVersion?: string;
  remoteVersion?: string;
  hasUpdate: boolean;
  message: string;
  checkedAt: string;
  changelogPath: string;
  versionFile: string;
  packageVersion?: string;
  recentNotes: string;
  statusLabel: string;
  hint: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  canUpdate: boolean;
  patchUrl?: string;
  sha256?: string;
  label?: string;
  size?: string;
  notes?: string;
  remoteLabel?: string;
  remoteSize?: string;
  remoteNotes?: string;
  error?: string;
  needsInit?: boolean;
}

export interface HotUpdateOptions {
  checkRemote?: boolean;
}

export interface ApplyHotUpdateInput {
  patchUrl?: string;
  sha256?: string;
  remoteVersion?: string;
}

interface RemoteManifest {
  version?: string;
  label?: string;
  size?: string;
  notes?: string;
  patchUrl?: string;
  sha256?: string;
}

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function getVersionFileCandidates(): string[] {
  const projectRoot = resolveProjectRoot();
  const candidates = [path.join(projectRoot, ".version")];

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "FEICAI-Studio", ".version"));
  }

  return candidates;
}

function readLocalVersion(): string {
  for (const candidate of getVersionFileCandidates()) {
    const version = readOptionalFile(candidate);
    if (version) {
      return version;
    }
  }

  return "";
}

function writeLocalVersion(version: string) {
  for (const candidate of getVersionFileCandidates()) {
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, version, "utf8");
  }
}

function tokenizeVersion(version: string): number[] {
  return version
    .trim()
    .toUpperCase()
    .replace(/^V/, "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(left: string, right: string): number {
  const leftParts = tokenizeVersion(left);
  const rightParts = tokenizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function toOptionalText(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function createBaseStatus(): HotUpdateStatus {
  const summary = getChangelogSummary();
  const currentVersion = readLocalVersion() || summary.currentVersion || UNKNOWN_CURRENT_VERSION;
  const recentNotes = summary.rawMarkdown
    ? summary.rawMarkdown.split(/\r?\n/).slice(0, 24).join("\n")
    : "";

  return {
    currentVersion,
    latestVersion: currentVersion,
    localVersion: currentVersion,
    remoteVersion: currentVersion,
    hasUpdate: false,
    message: "当前未检测到可用更新；如需升级，请使用新的版本包覆盖安装。",
    checkedAt: new Date().toISOString(),
    changelogPath: summary.changelogPath,
    versionFile: summary.versionFilePath,
    packageVersion: summary.packageVersion,
    recentNotes,
    statusLabel: `已是最新版本（${currentVersion}）`,
    hint: "点击「检查更新」查看是否有新版本可用",
    primaryActionLabel: "检查更新",
    secondaryActionLabel: "一键更新",
    canUpdate: false,
  };
}

async function fetchRemoteManifest(): Promise<RemoteManifest> {
  const manifestUrl = `${(process.env.FEICAI_UPDATE_MANIFEST_URL ?? DEFAULT_UPDATE_MANIFEST_URL).trim()}?t=${Date.now()}`;
  const response = await fetch(manifestUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法连接更新服务器 (${response.status})`);
  }

  const manifest = (await response.json()) as RemoteManifest;
  if (!manifest.version?.trim()) {
    throw new Error("更新清单缺少版本号");
  }

  return manifest;
}

function ensureAllowedPatchSource(patchUrl: string) {
  const hostname = new URL(patchUrl).hostname.toLowerCase();
  if (!hostname.endsWith(ALLOWED_PATCH_HOST_SUFFIX)) {
    throw new Error("不允许的更新源");
  }
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function extractPatchArchive(zipPath: string, projectRoot: string): number {
  const safeZipPath = escapePowerShellLiteral(zipPath);
  const safeProjectRoot = escapePowerShellLiteral(projectRoot);
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$root = [System.IO.Path]::GetFullPath('${safeProjectRoot}')`,
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${safeZipPath}')`,
    "$count = 0",
    "foreach ($entry in $zip.Entries) {",
    "  $dest = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $entry.FullName))",
    "  if (-not $dest.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { continue }",
    "  $dir = [System.IO.Path]::GetDirectoryName($dest)",
    "  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }",
    "  if ($entry.Name) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true); $count++ }",
    "}",
    "$zip.Dispose()",
    "Write-Output $count",
  ].join("; ");

  const output = execFileSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 300_000,
    windowsHide: true,
  });

  return Number.parseInt(output.trim(), 10) || 0;
}

export async function getHotUpdateStatus(options: HotUpdateOptions = {}): Promise<HotUpdateStatus> {
  const baseStatus = createBaseStatus();

  if (!options.checkRemote) {
    return baseStatus;
  }

  try {
    const manifest = await fetchRemoteManifest();
    const latestVersion = manifest.version!.trim();
    const needsInit = baseStatus.currentVersion === UNKNOWN_CURRENT_VERSION;
    const hasUpdate = needsInit || compareVersions(latestVersion, baseStatus.currentVersion) > 0;

    return {
      ...baseStatus,
      latestVersion,
      localVersion: baseStatus.currentVersion,
      remoteVersion: latestVersion,
      hasUpdate,
      patchUrl: hasUpdate ? toOptionalText(manifest.patchUrl) : undefined,
      sha256: hasUpdate ? toOptionalText(manifest.sha256) : undefined,
      label: toOptionalText(manifest.label),
      size: toOptionalText(manifest.size),
      notes: toOptionalText(manifest.notes),
      remoteLabel: toOptionalText(manifest.label),
      remoteSize: toOptionalText(manifest.size),
      remoteNotes: toOptionalText(manifest.notes),
      needsInit,
      checkedAt: new Date().toISOString(),
      statusLabel: hasUpdate
        ? `发现新版本（${baseStatus.currentVersion} → ${latestVersion}）`
        : `已是最新版本（${baseStatus.currentVersion}）`,
      hint: hasUpdate
        ? "检测到可安装的增量包，点击「一键更新」开始应用。"
        : "点击「检查更新」查看是否有新版本可用",
      message: hasUpdate
        ? `检测到可用新版本 ${latestVersion}，准备完成后可执行一键更新。`
        : "当前未检测到可用更新；如需升级，请使用新的版本包覆盖安装。",
      canUpdate: hasUpdate && Boolean(manifest.patchUrl?.trim()),
      error: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败";

    return {
      ...baseStatus,
      checkedAt: new Date().toISOString(),
      message: `检查更新失败: ${message}`,
      hint: "点击「检查更新」重试",
      error: message,
    };
  }
}

export async function applyHotUpdate(input: ApplyHotUpdateInput) {
  const patchUrl = input.patchUrl?.trim();
  const remoteVersion = input.remoteVersion?.trim();
  const sha256 = input.sha256?.trim();

  if (!patchUrl || !remoteVersion) {
    throw new Error("缺少更新参数");
  }

  ensureAllowedPatchSource(patchUrl);

  const response = await fetch(patchUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`下载失败 (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (sha256) {
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error("补丁校验失败，文件可能损坏");
    }
  }

  const tempZipPath = path.join(os.tmpdir(), `feicai_patch_${randomUUID().replace(/-/g, "")}.zip`);
  fs.writeFileSync(tempZipPath, buffer);

  try {
    const fileCount = extractPatchArchive(tempZipPath, resolveProjectRoot());
    writeLocalVersion(remoteVersion);

    const status = await getHotUpdateStatus();
    const nextStatus: HotUpdateStatus = {
      ...status,
      currentVersion: remoteVersion,
      latestVersion: remoteVersion,
      localVersion: remoteVersion,
      remoteVersion,
      hasUpdate: false,
      canUpdate: false,
      checkedAt: new Date().toISOString(),
      statusLabel: `已是最新版本（${remoteVersion}）`,
      message: `更新完成！更新了 ${fileCount} 个文件，当前版本 ${remoteVersion}`,
      hint: "点击「检查更新」查看是否有新版本可用",
      patchUrl: undefined,
      sha256: undefined,
      error: undefined,
    };

    return {
      success: true,
      message: nextStatus.message,
      version: remoteVersion,
      fileCount,
      needsRestart: true,
      status: nextStatus,
    };
  } finally {
    try {
      if (fs.existsSync(tempZipPath)) {
        fs.rmSync(tempZipPath, { force: true });
      }
    } catch {
      // ignore cleanup failures
    }
  }
}
