"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useToast } from "./Toast";
import {
  Archive,
  Download,
  FolderOpen,
  Loader,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  saveProjects,
  syncProjectFromDisk,
  type ArchivedProject,
} from "@/app/lib/projects";

interface ExportEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  projectId: string;
  projectName: string;
  exportedAt?: string;
}

interface ProjectExchangePanelProps {
  projects: ArchivedProject[];
  onProjectsChanged: (projects: ArchivedProject[]) => void;
}

async function readJsonFile(file: File): Promise<unknown> {
  const raw = await file.text();
  return JSON.parse(raw);
}

export default function ProjectExchangePanel({
  projects,
  onProjectsChanged,
}: ProjectExchangePanelProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportsList, setExportsList] = useState<ExportEntry[]>([]);
  const [exportDir, setExportDir] = useState("");
  const [loadingExports, setLoadingExports] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function loadExports() {
    setLoadingExports(true);
    try {
      const res = await fetch("/api/list-exports");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载导出列表失败");
      setExportsList(Array.isArray(data.files) ? data.files : []);
      setExportDir(typeof data.exportDir === "string" ? data.exportDir : "");
    } catch (e) {
      toast(`读取导出列表失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoadingExports(false);
    }
  }

  useEffect(() => {
    loadExports();
  }, []);

  async function syncImportedProject(projectId: string) {
    const project = await syncProjectFromDisk(projectId);
    if (!project) return null;
    const merged = [...projects];
    const idx = merged.findIndex((entry) => entry.id === project.id);
    if (idx >= 0) merged[idx] = project;
    else merged.unshift(project);
    await saveProjects(merged);
    onProjectsChanged(merged);
    return project;
  }

  async function handleExport(project: ArchivedProject) {
    setBusyKey(`export:${project.id}`);
    try {
      const res = await fetch("/api/export-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");

      const raw = JSON.stringify(data.bundle, null, 2);
      const blob = new Blob([raw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName || `${project.name}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast(`已导出项目「${project.name}」`, "success");
      await loadExports();
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleImportBundle(bundle: unknown, label: string) {
    setBusyKey(`import:${label}`);
    try {
      const res = await fetch("/api/import-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, preserveId: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      const project = await syncImportedProject(String(data.projectId || ""));
      await loadExports();
      toast(project ? `已导入项目「${project.name}」` : "项目已导入", "success");
    } catch (e) {
      toast(`导入失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUploadSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bundle = await readJsonFile(file);
      await handleImportBundle(bundle, file.name);
    } catch (e) {
      toast(`文件解析失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleImportSaved(entry: ExportEntry) {
    setBusyKey(`saved:${entry.name}`);
    try {
      const res = await fetch("/api/import-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: entry.name, preserveId: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      const project = await syncImportedProject(String(data.projectId || ""));
      toast(project ? `已导入导出包「${project.name}」` : "导出包已导入", "success");
    } catch (e) {
      toast(`导入失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="flex flex-col gap-5 w-full">
      <div className="flex items-center justify-between w-full">
        <h2 className="font-serif text-[20px] font-medium text-[var(--text-primary)]">
          项目迁移
        </h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleUploadSelected}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busyKey !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
          >
            <Upload size={12} />
            导入项目文件
          </button>
          <button
            onClick={loadExports}
            disabled={loadingExports || busyKey !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
          >
            {loadingExports ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新列表
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1.25fr_1fr] gap-5 w-full">
        <div className="flex flex-col border border-[var(--border-default)]">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-[var(--gold-primary)]" />
              <span className="text-[14px] font-medium text-[var(--text-primary)]">导出归档项目</span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">{projects.length} 个项目</span>
          </div>
          <div className="flex flex-col">
            {projects.length === 0 ? (
              <div className="px-5 py-8 text-[13px] text-[var(--text-muted)]">
                当前还没有可导出的归档项目。
              </div>
            ) : (
              projects.slice(0, 8).map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border-subtle)] last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{project.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      v{project.version || 1} · {project.imageCount} 张图 · {new Date(project.updatedAt || project.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleExport(project)}
                    disabled={busyKey !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--gold-primary)]/30 text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
                  >
                    {busyKey === `export:${project.id}` ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                    导出
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col border border-[var(--border-default)]">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-[var(--gold-primary)]" />
              <span className="text-[14px] font-medium text-[var(--text-primary)]">最近导出</span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">{exportsList.length} 个文件</span>
          </div>
          <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
            <div className="text-[11px] text-[var(--text-muted)] break-all">
              {exportDir || "尚未创建导出目录"}
            </div>
          </div>
          <div className="flex flex-col">
            {exportsList.length === 0 ? (
              <div className="px-5 py-8 text-[13px] text-[var(--text-muted)]">
                还没有导出记录。先在左侧导出一个项目，或直接导入外部 JSON 文件。
              </div>
            ) : (
              exportsList.slice(0, 8).map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border-subtle)] last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{entry.projectName || entry.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {entry.name} · {(entry.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => handleImportSaved(entry)}
                    disabled={busyKey !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                  >
                    {busyKey === `saved:${entry.name}` ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
                    导入
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
