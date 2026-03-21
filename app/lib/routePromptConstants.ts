export const STORYBOARD_EXCLUSION_TAGS = "no timecode, no subtitles";
export const STORYBOARD_STRICT_TEXT_BAN =
  " ABSOLUTE TEXT BAN: Do NOT render any visible text, captions, subtitles, speech bubbles, UI text, signs, logos, letters, or numbers anywhere in the image. STRICT NO-TEXT RULE: quoted dialogue is acting guidance only and must never appear as readable text.";

export const STORYBOARD_REFERENCE_CONSISTENCY_TAIL =
  "Use the reference images as the primary subject. Pay attention to the spatial layout of the environment, the relative positions of characters and all objects in the space. Generate coherent storyboard frames from different angles that follow the plot progression. Maintain strict consistency with the art style of the reference images.";

const DIALOGUE_QUOTE_PATTERNS = [
  /“[^”\n]{1,180}”/g,
  /"[^"\n]{1,180}"/g,
  /「[^」\n]{1,180}」/g,
  /『[^』\n]{1,180}』/g,
  /《[^》\n]{1,180}》/g,
  /〈[^〉\n]{1,180}〉/g,
  /‘[^’\n]{1,180}’/g,
];

export function buildEraWorldHint(timeSetting?: string, compact = false): string {
  if (!timeSetting?.trim()) return "";
  return compact
    ? ` Era/world: ${timeSetting.trim()}.`
    : `\n\nERA / WORLD BACKGROUND: ${timeSetting.trim()}.`;
}

export function stripQuotedDialogue(text: string): string {
  let next = text;
  for (const pattern of DIALOGUE_QUOTE_PATTERNS) {
    next = next.replace(pattern, "");
  }
  return next
    .replace(/[：:]\s*(?=[,.;，。])+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripStoryboardGridLayout(prompt: string): string {
  return prompt
    .replace(/\n\nGRID LAYOUT[\s\S]*?(?=\n\n(?:Shot|Frame)\s+\d+\s*\(|\n\nIMPORTANT:|$)/, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeStoryboardPromptForRoute(
  prompt: string,
  options: { preserveGridLayout?: boolean } = {}
): string {
  const { preserveGridLayout = false } = options;
  const withoutDialogue = stripQuotedDialogue(prompt);
  const normalized = preserveGridLayout ? withoutDialogue : stripStoryboardGridLayout(withoutDialogue);
  return normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildGridLayoutDiagram(options: {
  cols: number;
  rows: number;
  totalCells: number;
  isPortrait: boolean;
  portraitCellTokenPrefix?: string;
  landscapeCellLabel?: string;
}): string {
  const {
    cols,
    rows,
    totalCells,
    isPortrait,
    portraitCellTokenPrefix = "S",
    landscapeCellLabel = "Shot",
  } = options;

  const cellWidth = isPortrait ? 4 : 9;
  const lines: string[] = [];
  lines.push("┌" + Array.from({ length: cols }, () => "─".repeat(cellWidth)).join("┬") + "┐");

  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    if (isPortrait) {
      const blankLine = "│" + Array.from({ length: cols }, () => " ".repeat(cellWidth)).join("│") + "│";
      const labelLine = "│" + Array.from({ length: cols }, (_, colIndex) => {
        const idx = rowIndex * cols + colIndex + 1;
        if (idx > totalCells) return " ".repeat(cellWidth);
        const label = `${portraitCellTokenPrefix}${idx}`;
        const pad = cellWidth - label.length;
        const left = Math.floor(pad / 2);
        return " ".repeat(left) + label + " ".repeat(pad - left);
      }).join("│") + "│";
      lines.push(blankLine, labelLine, blankLine);
    } else {
      const rowLine = "│" + Array.from({ length: cols }, (_, colIndex) => {
        const idx = rowIndex * cols + colIndex + 1;
        if (idx > totalCells) return " ".repeat(cellWidth);
        const label = `${landscapeCellLabel} ${idx}`;
        const pad = cellWidth - label.length;
        const left = Math.floor(pad / 2);
        return " ".repeat(left) + label + " ".repeat(pad - left);
      }).join("│") + "│";
      lines.push(rowLine);
    }

    if (rowIndex < rows - 1) {
      lines.push("├" + Array.from({ length: cols }, () => "─".repeat(cellWidth)).join("┼") + "┤");
    }
  }

  lines.push("└" + Array.from({ length: cols }, () => "─".repeat(cellWidth)).join("┴") + "┘");
  const diagram = lines.join("\n");

  return isPortrait
    ? `GRID LAYOUT (${cols}×${rows} portrait cells, read left→right, top→bottom):\n${diagram}\nEach cell is PORTRAIT (taller than wide, 9:16 ratio).`
    : `GRID LAYOUT (read left→right, top→bottom):\n${diagram}`;
}

export function buildGridPlacementTail(options: {
  subjectLabel: string;
  bodyText: string;
  totalCells: number;
  isPortrait: boolean;
  timeSetting?: string;
  extraRules?: string;
}): string {
  const { subjectLabel, bodyText, totalCells, isPortrait, timeSetting, extraRules = "" } = options;
  const cellRatioHint = isPortrait
    ? ` CRITICAL: Each of the ${totalCells} cells must be PORTRAIT orientation (9:16 aspect ratio, taller than wide). Do NOT make landscape/wide cells.`
    : "";

  return `IMPORTANT: Place each ${subjectLabel} EXACTLY in its designated grid cell as shown above. ${bodyText}${STORYBOARD_EXCLUSION_TAGS}.${STORYBOARD_STRICT_TEXT_BAN}${cellRatioHint}${extraRules}${buildEraWorldHint(timeSetting)}\n\n${STORYBOARD_REFERENCE_CONSISTENCY_TAIL}`;
}

export function buildGridImageInstruction(options: {
  cols: number;
  rows: number;
  aspectRatio: string;
  resolutionText: string;
  descriptor?: string;
}): string {
  const { cols, rows, aspectRatio, resolutionText, descriptor = "cinematic storyboard grid image" } = options;
  return `Generate a ${cols}×${rows} ${descriptor}. Overall image aspect ratio: ${aspectRatio}. Each cell aspect ratio: ${aspectRatio}. ${resolutionText}`;
}

export function buildSingleFrameInstruction(options: {
  aspectRatio: string;
  resolutionText: string;
  timeSetting?: string;
}): string {
  const { aspectRatio, resolutionText, timeSetting } = options;
  return `Generate a high-quality cinematic storyboard frame. Aspect ratio ${aspectRatio}. ${resolutionText}Stable composition, realistic lighting, consistent characters, ${STORYBOARD_EXCLUSION_TAGS}.${STORYBOARD_STRICT_TEXT_BAN}${buildEraWorldHint(timeSetting, true)}\n\n${STORYBOARD_REFERENCE_CONSISTENCY_TAIL}`;
}
