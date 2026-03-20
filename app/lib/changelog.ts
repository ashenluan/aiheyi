import fs from "fs";
import { resolveProjectFile } from "@/app/lib/runtimePaths";

export type ChangeType = "feature" | "fix" | "improve" | "refactor";

export interface ChangeItem {
  type: ChangeType;
  text: string;
  section: string;
}

export interface VersionEntry {
  version: string;
  date: string;
  label: string;
  changes: ChangeItem[];
}

export interface ChangelogSummary {
  currentVersion: string;
  packageVersion: string;
  changelogPath: string;
  versionFilePath: string;
  rawMarkdown: string;
  entries: VersionEntry[];
}

const SECTION_TYPE_MAP: Record<string, ChangeType> = {
  "新增": "feature",
  "新功能": "feature",
  "修复": "fix",
  "优化": "improve",
  "改进": "improve",
  "重构": "refactor",
};

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

function normalizeSection(section: string): { label: string; type: ChangeType; known: boolean } {
  const label = section.trim() || "更新";
  const direct = SECTION_TYPE_MAP[label];
  if (direct) {
    return { label, type: direct, known: true };
  }
  const fuzzy = Object.entries(SECTION_TYPE_MAP).find(([key]) => label.includes(key));
  if (fuzzy) {
    return { label, type: fuzzy[1], known: true };
  }
  return { label, type: "improve", known: false };
}

function normalizeChangeText(section: { label: string; known: boolean }, text: string): string {
  if (!section.known && section.label !== "更新") {
    return `【${section.label}】${text}`;
  }
  return text;
}

export function parseChangelogMarkdown(markdown: string): VersionEntry[] {
  const entries: VersionEntry[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentEntry: VersionEntry | null = null;
  let currentSection = normalizeSection("更新");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "---") continue;

    const versionMatch = line.match(/^##\s+(.+?)\s+—\s+(V[0-9.]+)(?:\s+(.*))?$/);
    if (versionMatch) {
      currentEntry = {
        date: versionMatch[1].trim(),
        version: versionMatch[2].trim(),
        label: (versionMatch[3] || "更新日志").trim(),
        changes: [],
      };
      entries.push(currentEntry);
      currentSection = normalizeSection("更新");
      continue;
    }

    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      currentSection = normalizeSection(sectionMatch[1]);
      continue;
    }

    if (!currentEntry) continue;

    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      currentEntry.changes.push({
        type: currentSection.type,
        section: currentSection.label,
        text: normalizeChangeText(currentSection, bulletMatch[1].trim()),
      });
    }
  }

  return entries;
}

export function getChangelogSummary(): ChangelogSummary {
  const changelogPath = resolveProjectFile("CHANGELOG.md");
  const packageJsonPath = resolveProjectFile("package.json");
  const versionFilePath = resolveProjectFile(".version");
  const rawMarkdown = readOptionalFile(changelogPath);
  const entries = parseChangelogMarkdown(rawMarkdown);
  const versionFile = readOptionalFile(versionFilePath);
  const packageVersion = (() => {
    try {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version?: string };
      return parsed.version || "";
    } catch {
      return "";
    }
  })();
  const currentVersion = versionFile || entries[0]?.version || packageVersion || "source-dev";

  return {
    currentVersion,
    packageVersion,
    changelogPath,
    versionFilePath,
    rawMarkdown,
    entries,
  };
}
