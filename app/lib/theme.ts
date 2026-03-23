export const THEME_SETTING_KEY = "ui-theme";
export const THEME_CHANGE_EVENT = "feicai-theme-change";

export type UIThemeId =
  | "classic-gold"
  | "ocean-ink"
  | "jade-night"
  | "crimson-noir"
  | "paper-amber"
  | "sky-atelier";

export interface UIThemeDefinition {
  id: UIThemeId;
  label: string;
  description: string;
  accent: string;
  preview: [string, string, string];
}

export const DEFAULT_THEME_ID: UIThemeId = "classic-gold";

export const UI_THEMES: UIThemeDefinition[] = [
  {
    id: "classic-gold",
    label: "经典鎏金",
    description: "延续当前黑金质感，适合长时间工作。",
    accent: "#C9A962",
    preview: ["#0A0A0A", "#141414", "#C9A962"],
  },
  {
    id: "ocean-ink",
    label: "深海墨蓝",
    description: "更冷静的深海蓝调，适合脚本与导演流程。",
    accent: "#59B8D9",
    preview: ["#071018", "#0D1720", "#59B8D9"],
  },
  {
    id: "jade-night",
    label: "墨玉夜色",
    description: "绿色点亮关键动作，适合高频生产操作。",
    accent: "#63C48F",
    preview: ["#08110D", "#101A15", "#63C48F"],
  },
  {
    id: "crimson-noir",
    label: "绯夜酒红",
    description: "更偏创作展示感的暗红主题，适合提案与预览。",
    accent: "#D97C93",
    preview: ["#120B0F", "#1B1116", "#D97C93"],
  },
  {
    id: "paper-amber",
    label: "宣纸晨光",
    description: "米白纸感和暖金点缀，适合白天整理脚本与检查产出。",
    accent: "#B8823C",
    preview: ["#F4EBDC", "#FBF6ED", "#B8823C"],
  },
  {
    id: "sky-atelier",
    label: "晴空工坊",
    description: "轻盈的天青灰蓝，适合白天长时间编辑与比对细节。",
    accent: "#4E8FA8",
    preview: ["#E6EEF2", "#F7FBFD", "#4E8FA8"],
  },
];

const THEME_ID_SET = new Set<string>(UI_THEMES.map((theme) => theme.id));

export function resolveThemeId(value?: string | null): UIThemeId {
  if (value && THEME_ID_SET.has(value)) {
    return value as UIThemeId;
  }
  return DEFAULT_THEME_ID;
}

export function applyThemeToDocument(themeId?: string | null, doc: Document = document): UIThemeId {
  const resolved = resolveThemeId(themeId);
  doc.documentElement.dataset.uiTheme = resolved;
  return resolved;
}

export function readThemeFromSettings(rawSettings: string | null): UIThemeId {
  if (!rawSettings) return DEFAULT_THEME_ID;
  try {
    const parsed = JSON.parse(rawSettings) as Record<string, string>;
    return resolveThemeId(parsed[THEME_SETTING_KEY]);
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function getStoredThemeId(storage: Storage = window.localStorage): UIThemeId {
  return readThemeFromSettings(storage.getItem("feicai-settings"));
}
