"use client";

interface CanvasTabProps {
  value: "canvas" | "json";
  onChange: (value: "canvas" | "json") => void;
}

export default function CanvasTab({ value, onChange }: CanvasTabProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
      {[
        { id: "canvas", label: "画布模式" },
        { id: "json", label: "JSON 模式" },
      ].map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id as "canvas" | "json")}
            className={`rounded-full px-4 py-1.5 text-[12px] transition cursor-pointer ${
              active
                ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
