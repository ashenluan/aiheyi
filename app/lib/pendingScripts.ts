import fs from "fs";
import { resolveProjectFile } from "@/app/lib/runtimePaths";

export interface PendingScript {
  id: string;
  title: string;
  desc: string;
  content: string;
  source: string;
  importedAt: number;
  metadata?: Record<string, unknown>;
}

const PENDING_FILE = resolveProjectFile("pending-scripts.json");

export function getPendingScriptsFilePath(): string {
  return PENDING_FILE;
}

export function readPendingScripts(): PendingScript[] {
  if (!fs.existsSync(PENDING_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePendingScripts(scripts: PendingScript[]): void {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(scripts, null, 2), "utf-8");
}

export function clearPendingScripts(): void {
  writePendingScripts([]);
}

export function appendPendingScript(input: {
  title: string;
  desc?: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): PendingScript {
  const pending = readPendingScripts();
  const next: PendingScript = {
    id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title || "未命名剧本",
    desc: input.desc || "外部导入剧本",
    content: input.content,
    source: input.source || "external-import",
    importedAt: Date.now(),
    metadata: input.metadata,
  };
  pending.push(next);
  writePendingScripts(pending);
  return next;
}
