import Link from "next/link";
import {
  ScrollText,
  ArrowLeft,
  Rocket,
  Bug,
  Sparkles,
  Wrench,
  FileText,
} from "lucide-react";
import { getChangelogSummary, type ChangeType } from "@/app/lib/changelog";
import { getHotUpdateStatus } from "@/app/lib/hotUpdate";
import HotUpdateCard from "@/app/changelog/HotUpdateCard";

const typeIcon: Record<ChangeType, typeof Rocket> = {
  feature: Rocket,
  fix: Bug,
  improve: Sparkles,
  refactor: Wrench,
};

const typeLabel: Record<ChangeType, string> = {
  feature: "新功能",
  fix: "修复",
  improve: "优化",
  refactor: "重构",
};

const typeColor: Record<ChangeType, string> = {
  feature: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  fix: "text-red-400 bg-red-500/10 border-red-500/20",
  improve: "text-[var(--gold-primary)] bg-[var(--gold-transparent)] border-[var(--gold-primary)]/20",
  refactor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

export default async function ChangelogPage() {
  const summary = getChangelogSummary();
  const hotUpdate = await getHotUpdateStatus();

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto py-10 px-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">
          <ArrowLeft size={20} />
        </Link>
        <ScrollText size={22} className="text-[var(--gold-primary)]" />
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-[var(--text-primary)]">更新日志</h1>
          <p className="text-[12px] text-[var(--text-muted)]">
            当前版本: {summary.currentVersion}
            {summary.packageVersion ? ` · package.json ${summary.packageVersion}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.35fr_1fr]">
        <HotUpdateCard initialStatus={hotUpdate} />

        <div className="border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={15} className="text-[var(--gold-primary)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">日志来源</span>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed break-all">
            {summary.changelogPath}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-3">
            版本号优先读取本地 `.version`，日志条目解析本地 `CHANGELOG.md`。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-0">
        {summary.entries.length === 0 ? (
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 text-[13px] text-[var(--text-muted)]">
            当前没有读取到更新日志内容。
          </div>
        ) : (
          summary.entries.map((entry, idx) => (
            <div key={`${entry.version}-${entry.date}`} className="relative flex gap-4 pb-8 last:pb-0">
              {idx < summary.entries.length - 1 && (
                <div className="absolute left-[11px] top-[28px] bottom-0 w-px bg-[var(--border-default)]" />
              )}
              <div className="relative z-10 mt-1.5 w-[23px] h-[23px] rounded-full border-2 border-[var(--border-default)] bg-[var(--bg-surface)] flex items-center justify-center shrink-0">
                <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
              </div>
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[15px] font-semibold text-[var(--text-primary)]">{entry.version}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{entry.label}</span>
                  <span className="px-1.5 py-0.5 text-[10px] border rounded text-[var(--text-muted)] border-[var(--border-default)]">
                    本地日志
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">{entry.date}</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {entry.changes.map((change, changeIndex) => {
                    const Icon = typeIcon[change.type];
                    return (
                      <div key={`${entry.version}-${changeIndex}`} className="flex items-start gap-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border rounded shrink-0 mt-0.5 ${typeColor[change.type]}`}>
                          <Icon size={10} />
                          {typeLabel[change.type]}
                        </span>
                        <span className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{change.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
