import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";

import { ENTITY_MATCH_PROMPT } from "@/app/lib/defaultPrompts";
import type { EntityMatchResultSections } from "@/app/lib/episodeEntityMatch";
import { requireLicense } from "@/app/lib/license/requireLicense";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

interface EntityCandidate {
  id?: string;
  name: string;
  description?: string;
  aliases?: string[];
}

interface MatchResult {
  id: string;
  name: string;
  score: number;
  reason: string;
}

interface EntityMatchEpisodePayload {
  id: string;
  label?: string;
  beats?: string[];
}

interface EntityMatchRequestBody {
  text?: string;
  characters?: EntityCandidate[];
  scenes?: EntityCandidate[];
  props?: EntityCandidate[];
  limit?: number;
  settings?: Record<string, string>;
  episode?: EntityMatchEpisodePayload;
  customPrompt?: string;
}

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || null;
}

let cachedProxy: ProxyAgent | null | false = false;
function getProxyDispatcher(): ProxyAgent | null {
  if (cachedProxy !== false) return cachedProxy;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) { cachedProxy = null; return null; }
  try {
    cachedProxy = new ProxyAgent(proxyUrl);
  } catch {
    cachedProxy = null;
  }
  return cachedProxy;
}

async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    return fetch(url, { ...init, dispatcher } as RequestInit);
  }
  return fetch(url, init);
}

function isResponsesApi(provider?: string, baseUrl?: string): boolean {
  if (provider === "dashscope-responses") return true;
  if (baseUrl && baseUrl.includes("/api/v2/apps/protocols")) return true;
  return false;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLoose(value: string) {
  return normalize(value).replace(/[\s,，。！？、;；:：()（）【】《》〈〉「」『』"'`·•_\-\\/|]+/g, "");
}

function buildNameVariants(item: EntityCandidate) {
  const variants = new Map<string, { label: string; score: number; reason: string }>();
  const pushVariant = (value: string, score: number, reason: string) => {
    const label = value.trim();
    const key = normalizeLoose(label);
    if (!key || key.length < 2) return;
    const existing = variants.get(key);
    if (!existing || score > existing.score) {
      variants.set(key, { label, score, reason });
    }
  };

  pushVariant(item.name, 1, "命中实体名");
  for (const alias of item.aliases || []) {
    pushVariant(alias, 0.95, `命中别名：${alias}`);
  }

  const dottedParts = item.name
    .split(/[·•]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (dottedParts.length > 1) {
    pushVariant(dottedParts[0], 0.93, `命中角色基础名：${dottedParts[0]}`);
    for (const part of dottedParts.slice(1)) {
      pushVariant(part, 0.86, `命中形态后缀：${part}`);
    }
  }

  const bracketBase = item.name
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[【\[][^】\]]*[】\]]/g, "")
    .trim();
  if (bracketBase && bracketBase !== item.name) {
    pushVariant(bracketBase, 0.9, `命中基础名：${bracketBase}`);
  }

  return variants;
}

function calcScore(text: string, item: EntityCandidate): MatchResult | null {
  const normalizedText = normalize(text);
  const normalizedName = normalize(item.name);
  const normalizedTextLoose = normalizeLoose(text);
  if (!normalizedName) return null;

  const variants = buildNameVariants(item);
  for (const [variant, meta] of variants) {
    if (normalizedTextLoose.includes(variant)) {
      return {
        id: item.id || normalizedName,
        name: item.name,
        score: meta.score,
        reason: meta.reason,
      };
    }
  }

  for (const [variant, meta] of variants) {
    if (variant.length >= 3 && variant.includes(normalizedTextLoose)) {
      return {
        id: item.id || normalizedName,
        name: item.name,
        score: Math.max(0.72, meta.score - 0.16),
        reason: `文本片段命中：${meta.label}`,
      };
    }
  }

  const descriptionWords = normalize(item.description || "")
    .split(/[\s,，。！？、;；:：()（）【】《》]+/)
    .filter((word) => word.length >= 2);
  let hits = 0;
  for (const word of descriptionWords) {
    if (normalizedText.includes(word)) hits += 1;
  }
  if (hits >= 2) {
    return {
      id: item.id || normalizedName,
      name: item.name,
      score: Math.min(0.88, 0.55 + hits * 0.1),
      reason: `命中描述关键词 ${hits} 项`,
    };
  }

  return null;
}

function rankEntities(text: string, items: EntityCandidate[], limit: number): MatchResult[] {
  return items
    .map((item) => calcScore(text, item))
    .filter((item): item is MatchResult => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildCandidateBlock(label: string, items: EntityCandidate[]) {
  if (items.length === 0) return `【${label}候选】\n(无)`;
  return [
    `【${label}候选】`,
    ...items.map((item) => {
      const aliases = item.aliases?.filter(Boolean).join(" / ");
      const desc = (item.description || "").trim().slice(0, 120);
      return `- ${item.name}${aliases ? ` | 别名: ${aliases}` : ""}${desc ? ` | 描述: ${desc}` : ""}`;
    }),
  ].join("\n");
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  let text = content.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeMatch) text = codeMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const candidate = text.slice(firstBrace, lastBrace + 1).replace(/,\s*([\]}])/g, "$1");
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseNameArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0),
  ));
}

function resolveAiSelections(selectedNames: string[], items: EntityCandidate[]): MatchResult[] {
  const picked: MatchResult[] = [];
  const seen = new Set<string>();

  for (const selected of selectedNames) {
    const match = items
      .map((item) => calcScore(selected, item))
      .filter((item): item is MatchResult => Boolean(item))
      .sort((a, b) => b.score - a.score)[0];
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    picked.push({
      ...match,
      score: Math.max(match.score, 0.84),
      reason: `AI出场匹配：${selected}`,
    });
  }

  return picked;
}

async function callAiEntityMatcher({
  settings,
  episode,
  characters,
  scenes,
  props,
  customPrompt,
}: {
  settings: Record<string, string>;
  episode: EntityMatchEpisodePayload;
  characters: EntityCandidate[];
  scenes: EntityCandidate[];
  props: EntityCandidate[];
  customPrompt?: string;
}): Promise<EntityMatchResultSections> {
  const apiKey = (settings["llm-key"] || "").trim();
  const baseUrl = (settings["llm-url"] || "https://api.geeknow.top/v1").trim();
  const model = (settings["llm-model"] || "gemini-2.5-pro").trim();
  const provider = (settings["llm-provider"] || "").trim();
  if (!apiKey) throw new Error("缺少 LLM API Key，请先在设置页配置");

  const useResponsesApi = isResponsesApi(provider, baseUrl);
  let url = baseUrl.replace(/\/+$/, "");
  if (useResponsesApi) {
    if (!url.endsWith("/responses")) url += "/responses";
  } else if (!url.includes("/chat/completions")) {
    const isGeminiDirect = provider === "gemini" || /generativelanguage\.googleapis\.com/i.test(url);
    url += isGeminiDirect ? "/v1beta/openai/chat/completions" : "/chat/completions";
  }

  const episodeText = (episode.beats || [])
    .map((beat, index) => `格${index + 1}: ${String(beat || "").trim()}`)
    .filter((line) => line.length > 4)
    .join("\n\n");
  if (!episodeText) throw new Error("该集没有可分析的分镜提示词");

  const systemPrompt = (customPrompt || "").trim() || ENTITY_MATCH_PROMPT;
  const userPrompt = [
    `请分析 ${episode.label || episode.id.toUpperCase()} 的分镜提示词，判断实际出场的角色、场景、道具。`,
    "只允许从候选列表中挑选，不要新增名称。",
    buildCandidateBlock("角色", characters),
    buildCandidateBlock("场景", scenes),
    buildCandidateBlock("道具", props),
    "【本集分镜提示词】",
    episodeText,
    "请严格返回 JSON。",
  ].join("\n\n");

  const requestBody = useResponsesApi
    ? {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_output_tokens: 4096,
      temperature: 0,
    }
    : {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0,
    };

  const response = await proxyFetch(url, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(180000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`LLM API 错误 (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  let content = "";
  if (useResponsesApi) {
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) content += part.text;
          }
        }
      }
    }
    content ||= data.output_text || "";
  } else {
    const rawContent = data.choices?.[0]?.message?.content;
    if (typeof rawContent === "string") content = rawContent;
    else if (Array.isArray(rawContent)) {
      content = rawContent.map((part: Record<string, unknown>) => String(part.text || part.content || "")).join("");
    }
  }

  const parsed = extractJsonObject(content);
  if (!parsed) throw new Error("AI 出场匹配返回内容不是有效 JSON");

  return {
    characters: resolveAiSelections(parseNameArray(parsed.characters), characters),
    scenes: resolveAiSelections(parseNameArray(parsed.scenes), scenes),
    props: resolveAiSelections(parseNameArray(parsed.props), props),
  };
}

export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const body = (await request.json()) as EntityMatchRequestBody;
    const characters = Array.isArray(body.characters) ? body.characters : [];
    const scenes = Array.isArray(body.scenes) ? body.scenes : [];
    const props = Array.isArray(body.props) ? body.props : [];

    if (body.episode && body.settings) {
      const episode = body.episode;
      if (!episode.id) {
        return NextResponse.json({ error: "缺少 episode.id" }, { status: 400 });
      }
      const result = await callAiEntityMatcher({
        settings: body.settings,
        episode,
        characters,
        scenes,
        props,
        customPrompt: body.customPrompt,
      });
      return NextResponse.json({
        success: true,
        episodeId: episode.id,
        episodeLabel: episode.label || episode.id.toUpperCase(),
        result,
      });
    }

    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "缺少 text" }, { status: 400 });
    }

    const limit = Math.min(10, Math.max(1, Number(body.limit || 5)));
    return NextResponse.json({
      success: true,
      characters: rankEntities(text, characters, limit),
      scenes: rankEntities(text, scenes, limit),
      props: rankEntities(text, props, limit),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 },
    );
  }
}
