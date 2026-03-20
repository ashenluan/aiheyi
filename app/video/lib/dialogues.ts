"use client";

export interface ImportedDialogue {
  role: string;
  text: string;
  emotion?: string;
  strength?: string;
  speed?: string;
  voiceQuality?: string;
}

const SPEAKER_RE =
  /(?:(?:低声|轻声|沉声|大声|朗声|厉声|柔声|高声|怒声|急声|悄声|冷声|恨声|嘶声|颤声|冷冷[地的]?|淡淡[地的]?|缓缓[地的]?|微微|结巴[地的]?|疑惑[地的]?|焦急[地的]?|不屑[地的]?|无奈[地的]?|哽咽着?|嘲笑着?))?(?:说道|喊道|叫道|问道|答道|笑道|怒道|叹道|嘟囔道|嘀咕道|嘱咐道|吩咐道|感叹道|低吼道|呢喃道|嗤笑道|冷哼道|怒喝道|大喝道|轻叹道|惊呼道|追问道|反问道|接口道|开口道|吼道|喝道|说|道|喊|叫|笑|怒|叹|问|答|嘟囔|嘱咐|吩咐|开口|出声|呢喃)[:：]\s*$/;

const INVALID_SPEAKER_PREFIX = /^(他|她|它|我|你|其|那|这|某|有|朝着|对着|向着|正在)/;

function resolveSpeaker(source: string, index: number): string {
  const prefix = source.slice(Math.max(0, index - 50), index);
  const match = prefix.match(SPEAKER_RE);
  if (!match || match.index === undefined) return "角色";
  const raw = prefix.slice(0, match.index).trim();
  if (!raw) return "角色";

  let splitIndex = -1;
  for (const mark of ["。", "！", "？", "\n", "，", "、", "；", "："]) {
    const idx = raw.lastIndexOf(mark);
    if (idx > splitIndex) splitIndex = idx;
  }

  const candidate = raw.slice(splitIndex + 1).trim();
  if (candidate.length < 2 || INVALID_SPEAKER_PREFIX.test(candidate)) return "角色";

  for (let len = 2; len <= Math.min(4, candidate.length); len += 1) {
    const name = candidate.slice(0, len);
    if (INVALID_SPEAKER_PREFIX.test(name)) continue;
    return name;
  }

  return candidate.slice(0, 2);
}

export function extractDialogues(text: string): ImportedDialogue[] {
  if (!text) return [];
  const results: ImportedDialogue[] = [];
  const seen = new Set<string>();
  const regex = /[「“"'‘]([^」”"'’]+)[」”"'’]/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[1]?.trim();
    if (!value || value.length < 2 || seen.has(value)) continue;
    seen.add(value);
    results.push({
      role: resolveSpeaker(text, match.index),
      text: value,
    });
  }

  return results;
}

export function mergeDialogues(base: ImportedDialogue[], incoming: ImportedDialogue[]): ImportedDialogue[] {
  const seen = new Set(base.map((item) => item.text));
  const merged = [...base];
  for (const item of incoming) {
    if (!item.text || seen.has(item.text)) continue;
    seen.add(item.text);
    merged.push(item);
  }
  return merged;
}
