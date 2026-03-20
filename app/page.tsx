"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./components/Toast";
import Sidebar from "./components/Sidebar";
import {
  TrendingUp,
  Film,
  Sparkles,
  Check,
  ArrowRight,
  Trash2,
  RotateCcw,
  FolderOpen,
  Archive,
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  Pencil,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
} from "lucide-react";
import {
  loadProjects,
  saveProjects,
  deleteProject,
  restoreProject,
  overwriteProject,
  archiveCurrentWorkspace,
  renameProject,
  hasWorkspaceData,
  syncProjectFromDisk,
  type ArchivedProject,
} from "./lib/projects";

interface ExportEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  projectId: string;
  projectName: string;
  createdAt?: string;
}

async function readJsonFile(file: File): Promise<unknown> {
  const raw = await file.text();
  return JSON.parse(raw);
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<ArchivedProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [addChildTarget, setAddChildTarget] = useState<ArchivedProject | null>(null);
  const [childName, setChildName] = useState("");
  const childNameRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editNameRef = useRef<HTMLInputElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const [savedExports, setSavedExports] = useState<ExportEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 10;

  const refresh = useCallback(async () => {
    setProjects(await loadProjects());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadSavedExports = useCallback(async () => {
    try {
      const res = await fetch("/api/list-exports");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取导出列表失败");
      setSavedExports(Array.isArray(data.files) ? data.files : []);
    } catch (e) {
      toast(`读取导出列表失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
  }, [toast]);

  const syncImportedProjectRecord = useCallback(async (projectId: string) => {
    const project = await syncProjectFromDisk(projectId);
    if (!project) return null;
    const merged = [...projects];
    const idx = merged.findIndex((entry) => entry.id === project.id);
    if (idx >= 0) merged[idx] = project;
    else merged.unshift(project);
    await saveProjects(merged);
    setProjects(merged);
    return project;
  }, [projects]);

  const handleOpenImportModal = useCallback(async () => {
    await loadSavedExports();
    setShowImportModal(true);
  }, [loadSavedExports]);

  const handleImportBundle = useCallback(async (bundle: unknown, label: string) => {
    setImporting(true);
    try {
      const res = await fetch("/api/import-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, preserveId: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      const project = await syncImportedProjectRecord(String(data.projectId || ""));
      await loadSavedExports();
      toast(project ? `已导入项目「${project.name}」` : `已导入 ${label}`, "success");
      setShowImportModal(false);
    } catch (e) {
      toast(`导入失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [loadSavedExports, syncImportedProjectRecord, toast]);

  const handleImportSaved = useCallback(async (entry: ExportEntry) => {
    setImporting(true);
    try {
      const res = await fetch("/api/import-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: entry.name, preserveId: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      const project = await syncImportedProjectRecord(String(data.projectId || ""));
      toast(project ? `已导入导出包「${project.name}」` : `已导入 ${entry.name}`, "success");
      setShowImportModal(false);
    } catch (e) {
      toast(`导入失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setImporting(false);
    }
  }, [syncImportedProjectRecord, toast]);

  const handleUploadSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bundle = await readJsonFile(file);
      await handleImportBundle(bundle, file.name);
    } catch (e) {
      toast(`文件解析失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [handleImportBundle, toast]);

  const handleExportProject = useCallback(async (project: ArchivedProject) => {
    setLoading(true);
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
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.fileName || `${project.name}.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast(`已导出项目「${project.name}」`, "success");
      await loadSavedExports();
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  }, [loadSavedExports, toast]);

  // 树状结构计算
  const childrenMap = useMemo(() => {
    const map: Record<string, ArchivedProject[]> = {};
    for (const p of projects) {
      if (p.parentId) {
        if (!map[p.parentId]) map[p.parentId] = [];
        map[p.parentId].push(p);
      }
    }
    return map;
  }, [projects]);

  // 树状图默认收起，用户手动点击展开

  // 扁平化树为显示列表
  const displayRows = useMemo(() => {
    const rows: { project: ArchivedProject; isChild: boolean }[] = [];
    const allIds = new Set(projects.map(p => p.id));
    for (const p of projects) {
      if (!p.parentId || !allIds.has(p.parentId)) {
        rows.push({ project: p, isChild: false });
        if (expandedParents.has(p.id) && childrenMap[p.id]) {
          for (const c of childrenMap[p.id]) {
            rows.push({ project: c, isChild: true });
          }
        }
      }
    }
    return rows;
  }, [projects, expandedParents, childrenMap]);

  // 分页：按根项目计数（子项跟随父项不单独计页）
  const rootRows = useMemo(() => displayRows.filter(r => !r.isChild), [displayRows]);
  const totalPages = Math.max(1, Math.ceil(rootRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const pagedRows = useMemo(() => {
    const startIdx = (safePage - 1) * PAGE_SIZE;
    const pagedRoots = rootRows.slice(startIdx, startIdx + PAGE_SIZE);
    const rootIdSet = new Set(pagedRoots.map(r => r.project.id));
    return displayRows.filter(r => {
      if (!r.isChild) return rootIdSet.has(r.project.id);
      return rootIdSet.has(r.project.parentId || "");
    });
  }, [displayRows, rootRows, safePage]);

  // 项目数量变化时重置到第一页
  useEffect(() => { setCurrentPage(1); }, [projects.length]);

  const toggleExpand = (id: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (p: ArchivedProject) => {
    setEditingId(p.id);
    setEditName(p.name);
    setTimeout(() => editNameRef.current?.select(), 50);
  };

  const confirmRename = async () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (!trimmed) { setEditingId(null); return; }
    // 名称未变则直接关闭
    const orig = projects.find(p => p.id === editingId);
    if (orig && orig.name === trimmed) { setEditingId(null); return; }
    try {
      await renameProject(editingId, trimmed);
      toast(`已重命名为「${trimmed}」`, "success");
      refresh();
    } catch (e) {
      toast(`重命名失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
    setEditingId(null);
  };

  const cancelRename = () => { setEditingId(null); };

  const handleAddChild = (parent: ArchivedProject) => {
    const children = childrenMap[parent.id] || [];
    setChildName(`${parent.name}-章节${children.length + 1}`);
    setAddChildTarget(parent);
    setTimeout(() => childNameRef.current?.select(), 100);
  };

  const confirmAddChild = async () => {
    if (!addChildTarget || !childName.trim()) return;
    setLoading(true);
    try {
      await archiveCurrentWorkspace(childName.trim(), addChildTarget.id);
      toast(`已归档为「${addChildTarget.name}」的子项「${childName.trim()}」`, "success");
      setAddChildTarget(null);
      setExpandedParents(prev => new Set(prev).add(addChildTarget.id));
      refresh();
    } catch (e) {
      toast(`新增子项失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Metrics derived from projects
  const totalProjects = projects.length;
  const totalEpisodes = new Set(projects.map(p => p.episode)).size;
  const totalImages = projects.reduce((sum, p) => sum + p.imageCount, 0);
  const [hasActiveWorkspace, setHasActiveWorkspace] = useState(false);

  useEffect(() => {
    hasWorkspaceData().then(setHasActiveWorkspace);
  }, []);

  const metrics = [
    { label: "归档项目", value: String(totalProjects), icon: TrendingUp, detail: totalProjects > 0 ? `最新: ${projects[0]?.name}` : "暂无归档" },
    { label: "涉及集数", value: String(totalEpisodes || 0), icon: Film, detail: totalEpisodes > 0 ? `${Array.from(new Set(projects.map(p => p.episode))).join(", ").toUpperCase()}` : "无" },
    { label: "归档图片", value: String(totalImages), icon: Sparkles, detail: "九宫格 + 四宫格 + 一致性参考图" },
    { label: "工作台状态", value: hasActiveWorkspace ? "活跃" : "空闲", icon: Check, detail: hasActiveWorkspace ? "有进行中的工作" : "可开始新项目", gold: !hasActiveWorkspace },
  ];

  const handleRestore = async (project: ArchivedProject) => {
    if (!confirm(`确定要恢复项目「${project.name}」吗？\n\n当前工作台数据将被覆盖。`)) return;
    setLoading(true);
    try {
      const ok = await restoreProject(project.id);
      if (ok) {
        toast(`项目「${project.name}」已恢复`, "success");
        // Force full reload so studio picks up restored state
        window.location.href = "/studio";
      } else {
        toast("恢复失败：找不到该项目", "error");
      }
    } catch (e) {
      toast(`恢复失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (project: ArchivedProject) => {
    if (!confirm(`确定要永久删除归档项目「${project.name}」吗？\n\n此操作不可撤销，项目的所有图片数据将被删除。`)) return;
    setLoading(true);
    try {
      await deleteProject(project.id);
      toast(`已删除「${project.name}」`, "success");
      refresh();
    } catch (e) {
      toast(`删除失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // 上移/下移项目（仅针对根项目调整顺序）
  const handleMoveProject = async (projectId: string, direction: "up" | "down") => {
    // 找到所有根项目的顺序
    const allIds = new Set(projects.map(p => p.id));
    const roots = projects.filter(p => !p.parentId || !allIds.has(p.parentId));
    const idx = roots.findIndex(r => r.id === projectId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= roots.length) return;

    // 在完整数组中交换两个根项目的位置
    const fullArr = [...projects];
    const aIdx = fullArr.findIndex(p => p.id === roots[idx].id);
    const bIdx = fullArr.findIndex(p => p.id === roots[swapIdx].id);
    [fullArr[aIdx], fullArr[bIdx]] = [fullArr[bIdx], fullArr[aIdx]];

    try {
      await saveProjects(fullArr);
      setProjects(fullArr);
    } catch (e) {
      toast(`移动失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    }
  };

  const handleOverwriteArchive = async (project: ArchivedProject) => {
    if (!confirm(`确定要将当前工作台数据覆盖保存到「${project.name}」吗？\n\n原有的归档数据将被替换为当前工作台内容。`)) return;
    setLoading(true);
    try {
      const result = await overwriteProject(project.id);
      if (result) {
        toast(`已覆盖保存到「${project.name}」(v${result.version || 1})`, "success");
        refresh();
      } else {
        toast("覆盖失败：找不到该项目", "error");
      }
    } catch (e) {
      toast(`覆盖失败: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 flex flex-col gap-8 p-8 px-10 overflow-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-normal text-[var(--text-secondary)]">
              控制台
            </span>
            <h1 className="font-serif text-[40px] font-medium text-[var(--text-primary)]">
              项目总览
            </h1>
          </div>
          <button onClick={() => router.push("/pipeline")} className="flex items-center gap-2 bg-[var(--gold-primary)] px-5 py-2.5 hover:brightness-110 transition cursor-pointer">
            <Sparkles size={16} className="text-[#0A0A0A]" />
            <span className="text-[13px] font-medium text-[#0A0A0A]">
              进入工作台
            </span>
          </button>
        </div>

        {/* Metrics Row */}
        <div className="flex gap-5 w-full">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex flex-col gap-4 flex-1 p-6 border border-[var(--border-default)]"
              >
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                  {m.label}
                </span>
                <span
                  className={`font-serif text-[36px] font-medium tracking-tight ${
                    m.gold
                      ? "text-[var(--gold-primary)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {m.value}
                </span>
                <div className="flex items-center gap-2">
                  <Icon size={14} className="text-[var(--gold-primary)]" />
                  <span className="text-[13px] font-normal text-[var(--text-secondary)]">
                    {m.detail}
                  </span>
                </div>
              </div>
            );
          })}
        </div>


        {/* Archived Projects Section */}
        <div className="flex flex-col gap-5 w-full">
          <div className="flex items-center justify-between w-full">
            <h2 className="font-serif text-[24px] font-medium text-[var(--text-primary)]">
              我的项目
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-normal text-[var(--text-secondary)]">
                点击侧边栏 ＋ 按钮归档当前工作并创建新项目
              </span>
              <button
                onClick={handleOpenImportModal}
                disabled={importing}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
              >
                <Upload size={13} />
                {importing ? "导入中..." : "导入项目"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".fcproject,.json,application/json"
                className="hidden"
                onChange={handleUploadSelected}
              />
            </div>
          </div>

          {/* Project Table */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            {/* Table Header */}
            <div className="flex items-center px-5 py-3.5 border-b border-[var(--border-default)]">
              <div className="w-[220px] text-[12px] font-normal text-[var(--text-secondary)]">
                项目名称
              </div>
              <div className="w-[50px] text-[12px] font-normal text-[var(--text-secondary)]">
                版本
              </div>
              <div className="w-[60px] text-[12px] font-normal text-[var(--text-secondary)]">
                集数
              </div>
              <div className="flex-1 text-[12px] font-normal text-[var(--text-secondary)]">
                归档时间
              </div>
              <div className="w-[70px] text-[12px] font-normal text-[var(--text-secondary)]">
                图片数
              </div>
              <div className="w-[440px] text-[12px] font-normal text-[var(--text-secondary)] text-right">
                操作
              </div>
            </div>

            {/* Empty State */}
            {projects.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <FolderOpen size={40} className="text-[var(--text-muted)]" />
                <span className="text-[14px] text-[var(--text-secondary)]">
                  还没有归档项目
                </span>
                <span className="text-[12px] text-[var(--text-muted)]">
                  在侧边栏点击 ＋ 按钮，会将当前工作台数据归档保存到这里
                </span>
              </div>
            )}

            {/* Table Rows — 分页树状展示 */}
            {pagedRows.map(({ project: p, isChild }, i) => {
              const hasChildren = !!(childrenMap[p.id]?.length);
              const isExpanded = expandedParents.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`group flex items-center px-5 py-4 hover:bg-[var(--bg-surface)] transition ${
                    i < pagedRows.length - 1 ? "border-b border-[var(--border-default)]" : ""
                  } ${isChild ? "bg-[#ffffff03]" : ""}`}
                >
                  <div className={`flex items-center gap-2 w-[220px] min-w-0 ${isChild ? "pl-6" : ""}`}>
                    {!isChild && hasChildren ? (
                      <button onClick={() => toggleExpand(p.id)}
                        className="flex items-center justify-center w-5 h-5 text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer shrink-0">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : !isChild ? (
                      <div className="w-5 shrink-0" />
                    ) : (
                      <span className="text-[var(--text-muted)] text-[14px] w-5 text-center shrink-0">└</span>
                    )}
                    <div className={`flex items-center justify-center shrink-0 ${isChild ? "w-7 h-7" : "w-9 h-9"} bg-[var(--gold-transparent)]`}>
                      <span className={`font-serif font-semibold text-[var(--gold-primary)] ${isChild ? "text-[12px]" : "text-[14px]"}`}>
                        {(editingId === p.id ? editName : p.name).charAt(0) || "?"}
                      </span>
                    </div>
                    {editingId === p.id ? (
                      <input
                        ref={editNameRef}
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") cancelRename(); }}
                        onBlur={confirmRename}
                        className={`flex-1 min-w-0 px-1.5 py-0.5 bg-[var(--bg-surface)] border border-[var(--gold-primary)] text-[var(--text-primary)] outline-none ${isChild ? "text-[13px]" : "text-[14px]"}`}
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => startRename(p)}
                        title="点击重命名"
                        className={`flex items-center gap-1.5 min-w-0 cursor-pointer group/name ${isChild ? "text-[13px]" : "text-[14px]"}`}
                      >
                        <span className="font-medium text-[var(--text-primary)] truncate">{p.name}</span>
                        <Pencil size={12} className="shrink-0 text-transparent group-hover/name:text-[var(--text-muted)] transition" />
                      </button>
                    )}
                  </div>
                  <div className="w-[50px] text-[13px] font-normal text-[var(--text-secondary)]">
                    v{p.version || 1}
                  </div>
                  <div className="w-[60px] text-[14px] font-medium text-[var(--text-primary)]">
                    {(p.episodeCount || 1)} 集
                  </div>
                  <div className="flex-1 text-[13px] font-normal text-[var(--text-secondary)]">
                    {new Date(p.createdAt).toLocaleString("zh-CN")}
                  </div>
                  <div className="w-[70px] text-[14px] font-normal text-[var(--text-primary)]">
                    {p.imageCount} 张
                  </div>
                  <div className="flex items-center justify-end gap-1.5 w-[440px]">
                    {!isChild && (
                      <>
                        <button
                          onClick={() => handleMoveProject(p.id, "up")}
                          disabled={loading || rootRows.findIndex(r => r.project.id === p.id) === 0}
                          title="上移"
                          className="flex items-center justify-center w-7 h-7 border border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-20 disabled:cursor-default"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          onClick={() => handleMoveProject(p.id, "down")}
                          disabled={loading || rootRows.findIndex(r => r.project.id === p.id) === rootRows.length - 1}
                          title="下移"
                          className="flex items-center justify-center w-7 h-7 border border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-20 disabled:cursor-default"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          onClick={() => handleAddChild(p)}
                          disabled={loading}
                          className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                        >
                          <Plus size={12} /> 新增子项
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleExportProject(p)}
                      disabled={loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                    >
                      <Download size={12} /> 导出
                    </button>
                    <button
                      onClick={() => handleOverwriteArchive(p)}
                      disabled={loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--gold-primary)]/30 text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
                    >
                      <Archive size={12} /> 覆盖存档
                    </button>
                    <button
                      onClick={() => handleRestore(p)}
                      disabled={loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw size={12} /> 恢复
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
                      disabled={loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-red-500/30 text-[12px] text-red-400 hover:border-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 分页栏 */}
          {rootRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between w-full pt-2">
              <span className="text-[12px] text-[var(--text-muted)]">
                共 {rootRows.length} 个项目，第 {safePage}/{totalPages} 页
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
                >
                  <ChevronLeft size={12} /> 上一页
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className={`w-8 h-8 text-[12px] border transition cursor-pointer ${
                      pg === safePage
                        ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                        : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)]"
                    }`}
                  >
                    {pg}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-30 disabled:cursor-default"
                >
                  下一页 <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="flex flex-col gap-4 w-full">
          <h2 className="font-serif text-[20px] font-medium text-[var(--text-primary)]">
            快速入口
          </h2>
          <div className="flex gap-4 w-full">
            {[
              { label: "分镜流水线", desc: "剧本→分镜→提示词", href: "/pipeline" },
              { label: "生图工作台", desc: "九宫格/四宫格生图", href: "/studio" },
              { label: "产出中心", desc: "查看所有产出文件", href: "/outputs" },
            ].map(link => (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                className="flex items-center justify-between flex-1 px-5 py-4 border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer group"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[14px] font-medium text-[var(--text-primary)]">{link.label}</span>
                  <span className="text-[12px] text-[var(--text-secondary)]">{link.desc}</span>
                </div>
                <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--gold-primary)] transition" />
              </button>
            ))}
          </div>
        </div>

        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowImportModal(false)}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg w-[500px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-default)]">
                <h3 className="text-[16px] font-medium text-[var(--text-primary)]">选择要导入的项目</h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition cursor-pointer underline">
                    导入旧格式文件
                  </button>
                  <button onClick={() => setShowImportModal(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {savedExports.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-secondary)] text-center py-8">暂无可导入的导出文件夹</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {savedExports.map((entry) => (
                      <button
                        key={entry.name}
                        onClick={() => handleImportSaved(entry)}
                        disabled={importing}
                        className="flex items-center justify-between px-4 py-3 border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer text-left disabled:opacity-40 rounded"
                      >
                        <div>
                          <div className="text-[13px] text-[var(--text-primary)]">{entry.projectName || entry.name}</div>
                          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{entry.name}</div>
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("zh-CN") : entry.modified ? new Date(entry.modified).toLocaleDateString("zh-CN") : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-5 py-2.5 border-t border-[var(--border-default)] text-[11px] text-[var(--text-secondary)]">
                提示：将导出文件夹复制到 outputs/exports/ 目录后即可在此列表中看到
              </div>
            </div>
          </div>
        )}

        {/* 新增子项弹窗 */}
        {addChildTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="flex flex-col gap-4 w-[380px] bg-[var(--bg-page)] border border-[var(--border-default)] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">新增子项</span>
                <button onClick={() => setAddChildTarget(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">
                将当前工作台数据归档为 <strong className="text-[var(--gold-primary)]">{addChildTarget.name}</strong> 的子项章节。
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-[var(--text-muted)]">子项名称</label>
                <input ref={childNameRef} value={childName} onChange={e => setChildName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") confirmAddChild(); }}
                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                  placeholder="如：第一章、EP01..." />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={confirmAddChild} disabled={loading || !childName.trim()}
                  className="flex items-center gap-2 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50">
                  <Plus size={14} />
                  {loading ? "归档中..." : "确认归档"}
                </button>
                <button onClick={() => setAddChildTarget(null)}
                  className="flex-1 py-2.5 border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer text-center">
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
