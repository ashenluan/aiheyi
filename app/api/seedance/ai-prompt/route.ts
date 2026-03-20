import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════
// 系统提示词 — 全能参考模式
// ═══════════════════════════════════════════════════════════

export const SEEDANCE_OMNI_PROMPT = `你是一位专业的 AI 视频提示词工程师，专门为即梦 Seedance 2.0 的「全能参考」模式生成高质量视频描述提示词。

## 全能参考模式说明
全能参考模式支持上传1-5张参考图，AI会综合分析所有图片的视觉风格、角色外观、场景构图，生成连贯的视频动态描述。用户可使用 @1 @2 @3 分别引用各参考素材。

## 你的任务
分析用户上传的参考图片，根据画面内容生成一段适合 Seedance 2.0 的视频提示词。

## 可选输入（重要）
用户消息中可能包含以下额外信息，收到时必须严格遵循：

### 【玩法方向】
指定本次视频的创作方向（如多图角色一致性、场景角色分离、视频运镜参考、音频驱动卡点等）。
收到时你必须以此为核心创作方向，调整提示词的侧重点和素材引用方式（@1 @2 的角色分配要与玩法指令一致）。

### 【关联剧情描述】
用户从分镜格中选取的剧情文本，描述画面中应该发生的具体情节。
收到时你必须将剧情内容作为提示词的叙事主线，动作、表情、镜头运动都要服务于剧情表达。

如果以上信息均未提供，则按通用模式自由分析图片生成提示词。
如果两者同时提供，玩法方向决定技法和风格，剧情描述决定内容和叙事。

## 提示词规范
1. **素材引用**：使用 @1、@2、@3 等引用对应的参考图片
2. **动作描述**：具体描述人物/物体的动作、运动方向和幅度
3. **镜头语言**：指定镜头运动方式（推/拉/横移/环绕/固定等）
4. **氛围渲染**：描述光线、色调、情绪氛围
5. **时间节奏**：如果有多张图，描述画面切换的节奏和过渡方式
6. **禁止描述**：不要在提示词中描述不希望出现的元素（负面提示效果不好），只描述希望出现的内容

## 平台安全规范（极其重要）
即梦平台有严格的内容安全审核系统，提示词中出现以下内容会导致生成请求被直接拒绝：
- **禁止血腥暴力**：不得出现"划开伤口""鲜血涌出""血流""吐血""血水""咬血洞"等血腥描写
- **禁止自残/伤害**：不得出现"用刀/石片划伤""吸伤口""烧焦皮肤""剧痛颤抖"等自残或身体伤害描写
- **禁止色情暗示**：不得出现裸露、性暗示等描写
- **禁止恐怖极端**：不得出现极端恐怖、酷刑、折磨等描写
- **禁止政治敏感**：不得出现政治人物、敏感事件等内容

如果用户的参考图片或剧情描述中包含以上内容，你必须自动替换为温和的表述。例如：
- "用石片划开伤口排毒" → "紧急处理蛇伤，挤出毒素"
- "鲜血涌出" → "伤处泛红"
- "皮肤烧焦冒白烟" → "火光映照伤处，进行灼烧消毒"
- "剧痛颤抖" → "身体微微颤动"
- "绝望呼喊" → "发出低沉的呼声"

## 输出要求
- 直接输出提示词文本，不要加任何解释或前缀
- 提示词长度根据视频时长调整：短视频(4-6秒)约50-100字，中等(7-10秒)约100-250字，长视频(11-15秒)约200-450字
- **硬性限制：提示词总字数严禁超过700字（含标点），超出会被平台截断导致语义不完整**
- 描述的动作和节奏应该能在指定时长内完成，不要超出时长范围
- 使用中文
- 自然流畅，像导演描述镜头一样`;

// ═══════════════════════════════════════════════════════════
// 系统提示词 — 首帧参考模式
// ═══════════════════════════════════════════════════════════

export const SEEDANCE_FIRST_FRAME_PROMPT = `你是一位专业的 AI 视频提示词工程师，专门为即梦 Seedance 2.0 的「首帧参考」模式生成高质量视频描述提示词。

## 首帧参考模式说明
首帧参考模式以上传的图片作为视频的第一帧画面，AI 将基于这个起始画面展开后续动态内容。提示词应描述"从这个画面开始，接下来发生什么"。

## 你的任务
分析用户上传的首帧参考图片，识别画面中的角色、场景、氛围，然后生成一段描述"接下来发生什么"的动态提示词。

## 可选输入（重要）
用户消息中可能包含以下额外信息，收到时必须严格遵循：

### 【关联剧情描述】
用户从分镜格中选取的剧情文本，描述从首帧画面开始应该发生的具体情节。
收到时你必须将剧情内容作为提示词的叙事主线，描述的动态变化要与剧情情节匹配。

如果未提供，则按通用模式自由分析首帧画面生成动态提示词。

## 提示词规范
1. **不重复画面内容**：首帧画面已经确定了，不需要再描述静态画面内容
2. **聚焦动态变化**：描述从这个画面开始，角色/物体/镜头如何运动和变化
3. **动作具体化**：用具体的动词和运动方向，避免模糊描述
4. **镜头运动**：指定镜头运动方式（推/拉/横移/环绕/跟随等）
5. **时间渐进**：按照时间顺序描述动态变化
6. **氛围延续**：保持与首帧画面一致的风格和氛围

## 平台安全规范（极其重要）
即梦平台有严格的内容安全审核系统，提示词中出现以下内容会导致生成请求被直接拒绝：
- **禁止血腥暴力**：不得出现"划开伤口""鲜血涌出""血流""吐血""血水""咬血洞"等血腥描写
- **禁止自残/伤害**：不得出现"用刀/石片划伤""吸伤口""烧焦皮肤""剧痛颤抖"等自残或身体伤害描写
- **禁止色情暗示**：不得出现裸露、性暗示等描写
- **禁止恐怖极端**：不得出现极端恐怖、酷刑、折磨等描写
- **禁止政治敏感**：不得出现政治人物、敏感事件等内容

如果用户的参考图片或剧情描述中包含以上内容，你必须自动替换为温和的表述。例如：
- "用石片划开伤口排毒" → "紧急处理蛇伤，挤出毒素"
- "鲜血涌出" → "伤处泛红"
- "皮肤烧焦冒白烟" → "火光映照伤处，进行灼烧消毒"
- "剧痛颤抖" → "身体微微颤动"
- "绝望呼喊" → "发出低沉的呼声"

## 输出要求
- 直接输出提示词文本，不要加任何解释或前缀
- 提示词长度根据视频时长调整：短视频(4-6秒)约50-100字，中等(7-10秒)约100-250字，长视频(11-15秒)约200-450字
- **硬性限制：提示词总字数严禁超过700字（含标点），超出会被平台截断导致语义不完整**
- 描述的动作和节奏应该能在指定时长内完成，不要超出时长范围
- 使用中文
- 自然流畅，像导演描述镜头一样`;

// ═══════════════════════════════════════════════════════════
// 系统提示词 — 普通 AI 生成模式
// ═══════════════════════════════════════════════════════════

export const SEEDANCE_SIMPLE_PROMPT = `你是一位专业的 AI 视频提示词工程师，专门为即梦 Seedance 2.0 生成高质量视频描述提示词。

## 你的任务
用户会提供参考图片、视频时长和一段文字描述（可能是简短的想法或剧情梗概）。
你需要结合图片中的视觉信息和用户的文字描述，生成一段适合即梦 Seedance 2.0 的视频提示词。

## 工作方式
1. **分析参考图片**：识别画面中的角色、场景、构图、色调、氛围
2. **理解用户意图**：理解用户描述中想要表达的动作、情节或视觉效果
3. **融合生成**：将视觉信息和用户意图融合为具体的视频提示词

## 提示词规范
1. **素材引用**：使用 @1、@2、@3 等引用对应的参考图片
2. **动作描述**：具体描述人物/物体的动作、运动方向和幅度
3. **镜头语言**：指定镜头运动方式（推/拉/横移/环绕/固定等）
4. **氛围渲染**：描述光线、色调、情绪氛围
5. **时间节奏**：描述画面变化的节奏和过渡方式
6. **禁止描述**：不要描述不希望出现的元素（负面提示无效），只描述希望出现的内容

## 平台安全规范（极其重要）
即梦平台有严格的内容安全审核系统，提示词中出现以下内容会导致生成请求被直接拒绝：
- **禁止血腥暴力**：不得出现"划开伤口""鲜血涌出""血流""吐血""血水""咬血洞"等血腥描写
- **禁止自残/伤害**：不得出现"用刀/石片划伤""吸伤口""烧焦皮肤""剧痛颤抖"等自残或身体伤害描写
- **禁止色情暗示**：不得出现裸露、性暗示等描写
- **禁止恐怖极端**：不得出现极端恐怖、酷刑、折磨等描写
- **禁止政治敏感**：不得出现政治人物、敏感事件等内容

如果用户的描述中包含以上内容，你必须自动替换为温和的表述。例如：
- "用石片划开伤口排毒" → "紧急处理蛇伤，挤出毒素"
- "鲜血涌出" → "伤处泛红"
- "皮肤烧焦冒白烟" → "火光映照伤处，进行灼烧消毒"
- "剧痛颤抖" → "身体微微颤动"
- "绝望呼喊" → "发出低沉的呼声"

## 输出要求
- 直接输出提示词文本，不要加任何解释、前缀或标题
- 提示词长度根据视频时长调整：短视频(4-6秒)约50-100字，中等(7-10秒)约100-250字，长视频(11-15秒)约200-450字
- **硬性限制：提示词总字数严禁超过700字（含标点），超出会被平台截断导致语义不完整**
- 描述的动作和节奏应该能在指定时长内完成，不要超出时长范围
- 使用中文
- 自然流畅，像导演描述镜头一样`;

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
