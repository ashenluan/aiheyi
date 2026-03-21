import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";
import { SEEDANCE_FIRST_FRAME_PROMPT, SEEDANCE_OMNI_PROMPT, SEEDANCE_SIMPLE_PROMPT } from "@/app/lib/seedancePrompts";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════
// 图片压缩
// ═══════════════════════════════════════════════════════════

async function compressImageBuffer(
  buffer: Buffer,
  maxDim = 768,
  quality = 75,
): Promise<{ base64: string; mimeType: string }> {
  const compressed = await sharp(buffer)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return {
    base64: compressed.toString("base64"),
    mimeType: "image/jpeg",
  };
}

// ═══════════════════════════════════════════════════════════
// POST /api/seedance/ai-prompt
// ═══════════════════════════════════════════════════════════

export async function POST(request: Request) {
  const blocked = await requireLicense();
  if (blocked) return blocked;

  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "请求格式错误，需要 FormData" }, { status: 400 });
    }

    // 提取参数
    const mode = (formData.get("mode") as string) || "全能参考";
    const apiKey = formData.get("apiKey") as string;
    const baseUrl = formData.get("baseUrl") as string;
    const model = formData.get("model") as string;
    const provider = formData.get("provider") as string;
    const duration = parseInt(formData.get("duration") as string) || 5;
    const files = formData.getAll("files") as File[];
    // 玩法方向 & 剧情描述（PlayStylePicker 传入，可选）
    const playStyleDirection = (formData.get("playStyleDirection") as string) || "";
    const storyDescription = (formData.get("storyDescription") as string) || "";
    // 用户的文字描述（普通AI生成模式传入）
    const userPromptText = (formData.get("userPromptText") as string) || "";
    // 用户自定义提示词（来自提示词编辑页，可选）
    const customOmniPrompt = (formData.get("customOmniPrompt") as string) || "";
    const customFirstFramePrompt = (formData.get("customFirstFramePrompt") as string) || "";
    const customSimplePrompt = (formData.get("customSimplePrompt") as string) || "";

    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 LLM API Key，请在「设置」页面配置" },
        { status: 400 },
      );
    }
    if (files.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一张参考图片" },
        { status: 400 },
      );
    }

    // 压缩所有图片
    const compressedImages: { base64: string; mimeType: string }[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const img = await compressImageBuffer(buf);
      compressedImages.push(img);
    }

    // 优先使用用户自定义提示词（来自提示词编辑页）
    const systemPrompt = mode === "普通生成"
      ? (customSimplePrompt.length > 50 ? customSimplePrompt : SEEDANCE_SIMPLE_PROMPT)
      : mode === "首帧参考"
        ? (customFirstFramePrompt.length > 50 ? customFirstFramePrompt : SEEDANCE_FIRST_FRAME_PROMPT)
        : (customOmniPrompt.length > 50 ? customOmniPrompt : SEEDANCE_OMNI_PROMPT);

    // 构建用户提示
    const durationHint = `视频时长为 ${duration} 秒，请确保描述的动作和节奏能在 ${duration} 秒内自然完成。`;
    let baseUserText: string;
    if (mode === "普通生成") {
      // 普通模式：结合用户文字描述 + 参考图
      const imgRef = files.length === 1 ? "参考图片 @1" : `${files.length} 张参考图片（@1 到 @${files.length}）`;
      baseUserText = userPromptText.trim()
        ? `以下是${imgRef}。用户的描述如下：\n\n${userPromptText.trim()}\n\n请结合参考图片和用户描述，生成一段适合即梦 Seedance 2.0 的视频提示词。${durationHint}`
        : `以下是${imgRef}，请分析后生成一段适合即梦 Seedance 2.0 的视频提示词。${durationHint}`;
    } else if (mode === "首帧参考") {
      baseUserText = `这是视频的首帧画面，请分析后生成一段描述接下来动态变化的即梦提示词。${durationHint}`;
    } else {
      baseUserText = files.length === 1
        ? `这是一张参考图片 @1，请分析后生成一段适合即梦全能参考模式的视频提示词。${durationHint}`
        : `以下是 ${files.length} 张参考图片（从 @1 到 @${files.length}），请综合分析后生成一段适合即梦全能参考模式的视频提示词。${durationHint}`;
    }

    // 注入玩法方向（由 PlayStylePicker 提供）
    if (playStyleDirection) {
      baseUserText += `\n\n【玩法方向】${playStyleDirection}`;
    }
    // 注入关联剧情描述（由 StoryboardPicker 提供）
    if (storyDescription) {
      baseUserText += `\n\n【关联剧情描述】${storyDescription}\n请将以上剧情内容融入提示词的主体动作和叙事节奏中。`;
    }
    const userText = baseUserText;

    // ── 判断 API 格式 ──
    const urlLower = (baseUrl || "").toLowerCase();
    const isResponsesApi = provider === "dashscope-responses";
    const useGeminiNative =
      !isResponsesApi &&
      (urlLower.includes("geeknow") ||
        urlLower.includes("generativelanguage.googleapis.com") ||
        urlLower.includes("gemini"));

    let content = "";

    if (useGeminiNative) {
      // ── Gemini 原生 API（优先流式，回退非流式）──
      console.log(`[ai-prompt] 使用 Gemini 原生 API: model=${model}, url=${baseUrl}, images=${compressedImages.length}`);
      try {
        content = await callGeminiNative(
          baseUrl, apiKey, model, systemPrompt, userText, compressedImages,
        );
      } catch (e) {
        console.warn(`[ai-prompt] Gemini 原生 API 失败，回退到 Chat Completions:`, (e as Error).message?.slice(0, 200));
        // 回退到 OpenAI Chat Completions 格式
        content = await callOpenAICompat(
          baseUrl, apiKey, model, systemPrompt, userText, compressedImages, false,
        );
      }
    } else {
      // ── OpenAI Chat Completions 兼容 API ──
      console.log(`[ai-prompt] 使用 OpenAI ChatCompletions: model=${model}, url=${baseUrl}, images=${compressedImages.length}`);
      content = await callOpenAICompat(
        baseUrl, apiKey, model, systemPrompt, userText, compressedImages, isResponsesApi,
      );
    }

    if (!content.trim()) {
      console.error(`[ai-prompt] AI 返回为空 — mode=${mode}, model=${model}, provider=${provider}, url=${baseUrl}, useGemini=${useGeminiNative}`);
      return NextResponse.json(
        { error: `AI 返回为空，可能原因：1)API Key 无效 2)模型不支持多模态 3)代理超时。请检查「设置」页的 LLM 配置或重试` },
        { status: 502 },
      );
    }

    // 硬性截断：提示词不超过700字
    let result = content.trim();
    if (result.length > 700) {
      // 在最后一个完整句子处截断
      const truncated = result.slice(0, 700);
      const lastPeriod = Math.max(
        truncated.lastIndexOf("。"),
        truncated.lastIndexOf("，"),
        truncated.lastIndexOf("、"),
        truncated.lastIndexOf("."),
      );
      result = lastPeriod > 500 ? truncated.slice(0, lastPeriod + 1) : truncated;
    }

    return NextResponse.json({ prompt: result });
  } catch (err) {
    console.error("[ai-prompt] Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `生成提示词失败: ${msg}` }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════
// Gemini 原生 API 调用
// ═══════════════════════════════════════════════════════════

async function callGeminiNative(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: { base64: string; mimeType: string }[],
): Promise<string> {
  const cleanBase = baseUrl
    .replace(/\/+$/, "")
    .replace(/\/v1\/?$/i, "")
    .replace(/\/v1beta.*$/i, "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  parts.push({ text: userText });

  // 限制 thinking 预算 — 提示词生成是简单任务，不需要深度推理
  // Gemini 2.5 Pro 必须启用 thinking（budget=0 会返回 400 错误），
  // 所以用最小预算 128 tokens 来减少思考时间，避免代理超时导致截断
  const reqBody = {
    contents: [{ role: "user", parts }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 128 },
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  // ── 优先使用流式 API（避免 Gemini 2.5 Pro 思考超时）──
  const streamUrl = `${cleanBase}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  console.log(`[ai-prompt] Gemini streaming URL: ${streamUrl}`);

  let content = "";
  try {
    content = await callGeminiStreaming(streamUrl, headers, reqBody);
  } catch (e) {
    console.warn(`[ai-prompt] Gemini 流式失败，回退非流式:`, (e as Error).message?.slice(0, 150));
    // 回退到非流式
    const nonStreamUrl = `${cleanBase}/v1beta/models/${model}:generateContent`;
    const res = await fetch(nonStreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API 错误 (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    content = extractGeminiText(data);
  }

  return content;
}

/**
 * Gemini 流式调用 — 逐行解析 SSE，收集非思考部分的文本
 */
async function callGeminiStreaming(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini streaming 错误 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // 流结束时刷新解码器残留字节
      buffer += decoder.decode(undefined, { stream: false });
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("event:")) continue;
      let jsonStr = trimmed;
      if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        // 提取非思考文本
        const candidate = chunk?.candidates?.[0];
        // 记录 finishReason（最后一个 chunk 会包含 "STOP"）
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            // 跳过 Gemini 2.5 Pro 的思考部分
            if (part.thought) continue;
            if (part.text) content += part.text;
          }
        }
      } catch {
        // 解析失败的行跳过
      }
    }
  }

  // 处理流结束后 buffer 中残留的最后一行数据（修复截断问题）
  if (buffer.trim()) {
    let jsonStr = buffer.trim();
    if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5).trim();
    if (jsonStr && jsonStr !== "[DONE]") {
      try {
        const chunk = JSON.parse(jsonStr);
        const parts = chunk?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.thought) continue;
            if (part.text) content += part.text;
          }
        }
      } catch {
        // 最后一行解析失败，忽略
      }
    }
  }

  console.log(`[ai-prompt] Gemini streaming 收到 ${content.length} 字, finishReason=${finishReason}`);

  // 检测截断：如果有内容但 finishReason 不是 STOP，说明流被提前中断
  if (content.length > 0 && finishReason !== "STOP") {
    console.warn(`[ai-prompt] 流式响应可能被截断! finishReason=${finishReason || '(无)'}, 已收到 ${content.length} 字`);
    throw new Error(`流式响应被截断 (finishReason=${finishReason || '无'}，已收到 ${content.length} 字)`);
  }
  // 没有任何内容也视为异常
  if (content.length === 0) {
    throw new Error(`流式响应为空 (finishReason=${finishReason || '无'})`);
  }

  return content;
}

/**
 * 从 Gemini 非流式响应中提取文本（兼容 thinking 模式）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    console.warn(`[ai-prompt] Gemini 响应结构异常:`, JSON.stringify(data).slice(0, 500));
    return "";
  }

  // 优先取非思考部分
  const textParts = parts.filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text);
  if (textParts.length > 0) {
    return textParts.map((p: { text: string }) => p.text).join("");
  }

  // 如果全是思考部分，取最后一个 part 的文本（通常是最终输出）
  const lastPart = parts[parts.length - 1];
  return lastPart?.text || "";
}

// ═══════════════════════════════════════════════════════════
// OpenAI Chat Completions 兼容 API 调用
// ═══════════════════════════════════════════════════════════

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: { base64: string; mimeType: string }[],
  isResponsesApi: boolean,
): Promise<string> {
  let url = (baseUrl || "").replace(/\/+$/, "");
  if (isResponsesApi) {
    if (!url.endsWith("/responses")) url += "/responses";
  } else {
    if (!url.includes("/chat/completions")) url += "/chat/completions";
  }

  // 构建多模态消息
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "low" as const },
    })),
    { type: "text" as const, text: userText },
  ];

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API 错误 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`[ai-prompt] OpenAI 响应 keys:`, Object.keys(data));

  // OpenAI 格式
  if (data?.choices?.[0]?.message?.content) {
    const text = data.choices[0].message.content;
    console.log(`[ai-prompt] OpenAI 提取到 ${text.length} 字`);
    return text;
  }
  // Responses 格式
  if (data?.output) {
    if (typeof data.output === "string") return data.output;
    if (Array.isArray(data.output)) {
      const textItem = data.output.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any) => item.type === "message" && item.content?.[0]?.text
      );
      return textItem?.content?.[0]?.text || "";
    }
  }
  console.warn(`[ai-prompt] OpenAI 响应解析失败:`, JSON.stringify(data).slice(0, 500));
  return "";
}
