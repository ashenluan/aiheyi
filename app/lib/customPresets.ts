import fs from "fs";
import { resolveProjectFile } from "@/app/lib/runtimePaths";

export type CustomPresetType = "llm" | "image" | "video" | "prompt" | "other";

export interface CustomPreset {
  id: string;
  type: CustomPresetType;
  label: string;
  payload: Record<string, unknown>;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

interface PresetStore {
  presets: CustomPreset[];
  updatedAt: string;
}

const PRESET_FILE = resolveProjectFile("feicai-custom-presets.json");

function buildDefaultStore(): PresetStore {
  return {
    presets: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getCustomPresetFilePath(): string {
  return PRESET_FILE;
}

export function readCustomPresetStore(): PresetStore {
  if (!fs.existsSync(PRESET_FILE)) return buildDefaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(PRESET_FILE, "utf-8")) as Partial<PresetStore>;
    const presets = Array.isArray(parsed.presets) ? parsed.presets : [];
    return {
      presets,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return buildDefaultStore();
  }
}

export function writeCustomPresetStore(store: PresetStore): PresetStore {
  const next = {
    presets: store.presets,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PRESET_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function upsertCustomPreset(input: Partial<CustomPreset> & {
  type: CustomPresetType;
  label: string;
  payload: Record<string, unknown>;
}): PresetStore {
  const store = readCustomPresetStore();
  const now = new Date().toISOString();
  const id = typeof input.id === "string" && input.id.trim()
    ? input.id.trim()
    : `${input.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const existingIndex = store.presets.findIndex((preset) => preset.id === id);
  const nextPreset: CustomPreset = {
    id,
    type: input.type,
    label: input.label,
    payload: input.payload,
    note: input.note,
    createdAt: existingIndex >= 0 ? store.presets[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    store.presets[existingIndex] = nextPreset;
  } else {
    store.presets.unshift(nextPreset);
  }

  return writeCustomPresetStore(store);
}

export function deleteCustomPreset(id: string): PresetStore {
  const store = readCustomPresetStore();
  store.presets = store.presets.filter((preset) => preset.id !== id);
  return writeCustomPresetStore(store);
}
