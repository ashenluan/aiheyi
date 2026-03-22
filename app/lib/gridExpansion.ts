export interface GridExpandTemplate {
  key: string;
  label: string;
  gridCount: number;
  dimension: string;
  description: string;
}

export interface GridCellBounds {
  index: number;
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridExpandEntityMatchHit {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface GridExpandEntityMatchSummary {
  characters: GridExpandEntityMatchHit[];
  scenes: GridExpandEntityMatchHit[];
  props: GridExpandEntityMatchHit[];
}

export const GRID_EXPAND_TEMPLATES: GridExpandTemplate[] = [
  {
    key: "grid-9",
    label: "9格",
    gridCount: 9,
    dimension: "3×3",
    description: "标准九宫格，适合单集节拍拆解与常规镜头规划。",
  },
  {
    key: "grid-16",
    label: "16格",
    gridCount: 16,
    dimension: "4×4",
    description: "扩展镜头覆盖面，适合更密集的动作和情绪切换。",
  },
  {
    key: "grid-25",
    label: "25格",
    gridCount: 25,
    dimension: "5×5",
    description: "长剧情批量拆镜与 Gemini 多镜头批量生图模式。",
  },
];

export function clampGridCount(value: number, fallback = 9): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(25, Math.max(1, normalized || fallback));
}

export function resolveGridDimension(gridCount: number): { cols: number; rows: number } {
  const safeCount = clampGridCount(gridCount);
  if (safeCount <= 1) return { cols: 1, rows: 1 };
  if (safeCount <= 4) return { cols: 2, rows: 2 };
  if (safeCount <= 9) return { cols: 3, rows: 3 };
  if (safeCount <= 16) return { cols: 4, rows: 4 };
  return { cols: 5, rows: Math.ceil(safeCount / 5) };
}

export function calculateSubGridCells(
  imageWidth: number,
  imageHeight: number,
  gridCount: number,
): GridCellBounds[] {
  const { cols, rows } = resolveGridDimension(gridCount);
  const safeCount = clampGridCount(gridCount);
  const cellWidth = Math.floor(imageWidth / cols);
  const cellHeight = Math.floor(imageHeight / rows);
  const cells: GridCellBounds[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const left = col * cellWidth;
    const top = row * cellHeight;
    const width = col === cols - 1 ? imageWidth - left : cellWidth;
    const height = row === rows - 1 ? imageHeight - top : cellHeight;
    cells.push({ index, row, col, left, top, width, height });
  }

  return cells;
}

export function buildGridExpansionPrompt(input: string, targetGridCount: number, title?: string, customPrompt?: string): string {
  const safeCount = clampGridCount(targetGridCount);
  const header = title?.trim() ? `项目标题：${title.trim()}` : "";
  const promptOverride = customPrompt?.trim();
  if (promptOverride) {
    return [
      promptOverride,
      "",
      header,
      `目标宫格数：${safeCount}`,
      "待拆解文本：",
      input.trim(),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "你是一位专业影视分镜拆解师。",
    `请把用户提供的台词/剧本拆解成 ${safeCount} 格自定义分镜提示词。`,
    "要求：",
    "1. 每格只保留一个最重要的镜头瞬间，整体要形成连贯推进。",
    "2. 优先覆盖角色、场景、动作、情绪、镜头变化，不要重复表达同一画面。",
    "3. 中文输出，每格 1-2 句，便于后续再翻译为生图提示词。",
    "4. 保留关键人物称呼、关键道具和场景线索，不要杜撰新剧情。",
    "5. 严格按编号输出，从 1 到目标格数，不要附加解释。",
    "",
    header,
    "输出格式示例：",
    "1. 镜头描述",
    "2. 镜头描述",
    `...一直到 ${safeCount}.`,
    "",
    "待拆解文本：",
    input.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCustomScriptImportRequest(input: string, targetGridCount: number, title?: string): string {
  const safeCount = clampGridCount(targetGridCount);
  return [
    title?.trim() ? `标题：${title.trim()}` : "",
    `目标格数：${safeCount}`,
    "请按分镜节奏拆成编号列表，每格一条。",
    input.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseGridPromptLines(content: string, targetGridCount: number): string[] {
  const safeCount = clampGridCount(targetGridCount);
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines
    .map((line) => line.replace(/^\d+[\.\)、\s-]+/, "").trim())
    .filter(Boolean);

  if (numbered.length >= safeCount) return numbered.slice(0, safeCount);
  return splitTextIntoGridPrompts(content, safeCount);
}

export function splitTextIntoGridPrompts(input: string, targetGridCount: number): string[] {
  const safeCount = clampGridCount(targetGridCount);
  const normalized = input
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return Array.from({ length: safeCount }, (_, index) => `第${index + 1}格：补充镜头描述`);
  }

  const segments = normalized
    .split(/\n{2,}|(?<=[。！？!?；;])/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const source = segments.length > 0 ? segments : [normalized];
  const prompts = Array.from({ length: safeCount }, (_, index) => source[index % source.length]);
  return prompts.map((segment, index) => `第${index + 1}格：${segment}`);
}

export function buildCustomGridPushPayload(
  prompts: string[],
  gridCount: number,
  source = "grid-expand",
  entitySummary?: GridExpandEntityMatchSummary,
) {
  return {
    source,
    count: clampGridCount(gridCount),
    prompts: prompts.slice(0, clampGridCount(gridCount)),
    entitySummary,
    timestamp: Date.now(),
  };
}
