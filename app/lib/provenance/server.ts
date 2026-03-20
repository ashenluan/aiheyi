import { writeOutputFile } from "@/app/lib/outputs";
import { getActiveProjectFileId } from "@/app/lib/paths";
import type {
  CreateProvenanceManifestInput,
  ProvenanceKind,
  ProvenanceManifest,
} from "./types";

function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function normalizeEpisode(value: string): string {
  const trimmed = String(value || "").trim();
  return /^[a-z0-9_-]+$/i.test(trimmed) ? trimmed : "ep00";
}

function promptPreview(prompt?: string): string | undefined {
  if (!prompt) return undefined;
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.slice(0, 240);
}

function buildTimestampParts(date: Date) {
  const pad = (value: number, len = 2) => String(value).padStart(len, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const ms = pad(date.getMilliseconds(), 3);
  return { day, time, ms };
}

function buildFilename(kind: ProvenanceKind, episode: string, stage: string, date: Date): string {
  const { day, time, ms } = buildTimestampParts(date);
  const kindSlug = kind === "studio-image" ? "studio" : "video";
  return `provenance-${kindSlug}-${normalizeEpisode(episode)}-${safeSlug(stage)}-${day}-${time}-${ms}.json`;
}

export function saveProvenanceManifest(input: CreateProvenanceManifestInput) {
  const now = new Date();
  const manifest: ProvenanceManifest = {
    schemaVersion: 1,
    kind: input.kind,
    title: input.title,
    stage: input.stage,
    episode: normalizeEpisode(input.episode),
    createdAt: now.toISOString(),
    createdAtUnix: now.getTime(),
    projectId: getActiveProjectFileId(),
    prompt: input.prompt,
    promptPreview: promptPreview(input.prompt),
    model: input.model,
    inputs: input.inputs,
    outputs: input.outputs,
    context: input.context,
  };

  const filename = buildFilename(input.kind, manifest.episode, input.stage, now);
  writeOutputFile(filename, JSON.stringify(manifest, null, 2));
  return { filename, manifest };
}
