import fs from "fs";
import path from "path";
import { getBaseOutputDir } from "@/app/lib/paths";
import { ensureProjectDir } from "@/app/lib/runtimePaths";

export interface ProjectExportBundle {
  format: "feicai-project-export";
  version: 1;
  exportedAt: string;
  source: {
    app: string;
    version: string;
  };
  project: Record<string, unknown>;
  outputFiles: { name: string; content: string }[];
}

const EXPORTS_DIR_NAME = "exports";

function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_\-.]/g, "");
}

function getProjectsDir(): string {
  return path.join(getBaseOutputDir(), "projects");
}

function getProjectDir(projectId: string): string {
  return path.join(getProjectsDir(), sanitizeProjectId(projectId));
}

export function getExportsDir(): string {
  return ensureProjectDir(EXPORTS_DIR_NAME);
}

export function loadProjectBundleFromDisk(projectId: string, sourceVersion: string): ProjectExportBundle {
  const projectDir = getProjectDir(projectId);
  const metadataPath = path.join(projectDir, "metadata.json");

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  const project = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
  const outputDir = path.join(projectDir, "output-files");
  const outputFiles = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir)
        .filter((name) => fs.statSync(path.join(outputDir, name)).isFile())
        .map((name) => ({
          name,
          content: fs.readFileSync(path.join(outputDir, name), "utf-8"),
        }))
    : [];

  return {
    format: "feicai-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      app: "FEICAI Studio Source",
      version: sourceVersion,
    },
    project,
    outputFiles,
  };
}

export function saveProjectBundle(bundle: ProjectExportBundle, preferredName?: string): {
  fileName: string;
  filePath: string;
  size: number;
} {
  const exportDir = getExportsDir();
  const projectName = String(bundle.project.name || bundle.project.id || "project")
    .replace(/[<>:\"/\\\\|?*]+/g, "_")
    .trim();
  const stamped = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = preferredName?.trim() || `${projectName || "project"}-${stamped}.json`;
  const safeName = path.basename(baseName).endsWith(".json") ? path.basename(baseName) : `${path.basename(baseName)}.json`;
  const filePath = path.join(exportDir, safeName);
  const raw = JSON.stringify(bundle, null, 2);
  fs.writeFileSync(filePath, raw, "utf-8");
  return {
    fileName: safeName,
    filePath,
    size: Buffer.byteLength(raw, "utf-8"),
  };
}

export function listSavedProjectBundles(): Array<{
  name: string;
  path: string;
  size: number;
  modified: string;
  projectId: string;
  projectName: string;
  exportedAt?: string;
}> {
  const exportDir = getExportsDir();
  return fs.readdirSync(exportDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(exportDir, name);
      const stat = fs.statSync(filePath);
      let projectId = "";
      let projectName = "";
      let exportedAt = "";
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<ProjectExportBundle>;
        projectId = String(parsed.project && typeof parsed.project === "object" ? (parsed.project as { id?: string }).id || "" : "");
        projectName = String(parsed.project && typeof parsed.project === "object" ? (parsed.project as { name?: string }).name || "" : "");
        exportedAt = typeof parsed.exportedAt === "string" ? parsed.exportedAt : "";
      } catch {
        // ignore parse errors, still list the file
      }
      return {
        name,
        path: filePath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        projectId,
        projectName,
        exportedAt,
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export function readSavedProjectBundle(fileName: string): ProjectExportBundle {
  const safeName = path.basename(fileName);
  const filePath = path.join(getExportsDir(), safeName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`导出文件不存在: ${safeName}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ProjectExportBundle;
}

export function importProjectBundle(bundle: ProjectExportBundle, options?: {
  preserveId?: boolean;
  overwrite?: boolean;
}): { projectId: string; metadataPath: string; importedFiles: number } {
  if (bundle.format !== "feicai-project-export") {
    throw new Error("无效的项目导入文件格式");
  }

  const project = (bundle.project || {}) as Record<string, unknown>;
  const rawId = typeof project.id === "string" ? project.id : `proj_import_${Date.now()}`;
  let projectId = options?.preserveId === false ? `proj_import_${Date.now()}` : sanitizeProjectId(rawId);
  if (!projectId) {
    projectId = `proj_import_${Date.now()}`;
  }

  const projectDir = getProjectDir(projectId);
  if (fs.existsSync(projectDir) && !options?.overwrite) {
    projectId = `${projectId}_${Date.now()}`;
  }

  const finalProjectDir = getProjectDir(projectId);
  fs.mkdirSync(finalProjectDir, { recursive: true });

  const nextProject = {
    ...project,
    id: projectId,
    importedAt: new Date().toISOString(),
  };

  const metadataPath = path.join(finalProjectDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(nextProject, null, 2), "utf-8");

  const outputDir = path.join(finalProjectDir, "output-files");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFiles = Array.isArray(bundle.outputFiles) ? bundle.outputFiles : [];
  let importedFiles = 0;
  for (const file of outputFiles) {
    if (!file?.name || typeof file.content !== "string") continue;
    const safeName = file.name.replace(/[<>:\"/\\\\|?*]/g, "_");
    fs.writeFileSync(path.join(outputDir, safeName), file.content, "utf-8");
    importedFiles++;
  }

  return { projectId, metadataPath, importedFiles };
}
