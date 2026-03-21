import { NextResponse } from "next/server";
import { ANALYZE_SCRIPT_PROMPT } from "@/app/lib/analyzeScriptPrompt";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─── JSON 修复工具（防止 AI 输出截断/格式异常导致 422）───

/**
 * 尝试关闭截断的 JSON —— 追踪括号栈，移除不完整的末尾 KV 对，自动补全闭合
 */
function closeTruncatedJson(s: string): string | null {
  // ★ Step A: 如果截断在字符串内部，先关闭未闭合的字符串
  let fixed = s;
  let inStr = false, esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"') inStr = !inStr;
  }
  if (inStr) {
    // 截断在字符串内 → 闭合引号
    // 先移除末尾可能的半个转义序列
    fixed = fixed.replace(/\\$/, "");
    fixed += '"';
  }

  // ★ Step B: 追踪括号栈
  const stack: string[] = [];
  inStr = false; esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = inStr; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (stack.length === 0) return null; // 已完整

  // ★ Step C: 移除末尾不完整的 key-value 或数组元素
  let trimmed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*("[^"]*"?)?$/, "");
  trimmed = trimmed.replace(/,\s*"[^"]*$/, "");
  trimmed = trimmed.replace(/,\s*$/, "");
  return trimmed + stack.reverse().join("");
}

/**
 * 7 步 JSON 修复 + 解析（适配 AI 输出的各种异常格式）
 * 返回解析后的对象，失败返回 null
 */
function repairAnalysisJson(raw: string): Record<string, unknown> | null {
  // Step 1: 清理 BOM / 不可见字符
  let s = raw.replace(/^\uFEFF/, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");

  // Step 2: 提取 markdown code block
  const mdMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) s = mdMatch[1].trim();

  // Step 3: 提取最外层 {} 对象
  const objStart = s.indexOf("{");
  const objEnd = s.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    s = s.slice(objStart, objEnd + 1);
  } else if (objStart >= 0) {
    // 只有开头 { 没有结尾 } — 截断情况
    s = s.slice(objStart);
  }

  // Step 3b: 转义字符串内未转义的控制字符（换行/制表符）
  let cleaned = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { cleaned += c; esc = false; continue; }
    if (c === "\\") { cleaned += c; esc = inStr; continue; }
    if (c === '"') { cleaned += c; inStr = !inStr; continue; }
    if (inStr) {
      if (c === "\n") { cleaned += "\\n"; continue; }
      if (c === "\r") { cleaned += "\\r"; continue; }
      if (c === "\t") { cleaned += "\\t"; continue; }
    }
    cleaned += c;
  }
  s = cleaned;

  // Step 4: 常见修复 — 尾逗号、JS 注释、省略号占位符
  s = s.replace(/,\s*([\]}])/g, "$1");
  s = s.replace(/\/\/[^\n]*/g, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/"\.\.\."?/g, '""');
  s = s.replace(/,\s*\.\.\.[\s\S]*?([\]}])/g, "$1");

  // Step 5: 尝试直接解析
  try {
    const obj = JSON.parse(s);
    if (typeof obj === "object" && obj !== null) return obj;
  } catch { /* continue */ }

  // Step 6: 截断修复 — 自动补全闭合括号
  const closed = closeTruncatedJson(s);
  if (closed) {
    try {
      const obj = JSON.parse(closed);
      if (typeof obj === "object" && obj !== null) {
        console.warn("[analyze-script] JSON 截断已修复（自动补全闭合括号）");
        return obj;
      }
    } catch { /* continue */ }
  }

  // Step 7: 渐进式尾部裁剪 — 从末尾逐步回退寻找可解析位置
  for (let i = s.length - 1; i > s.length / 2; i--) {
    if (s[i] === "}" || s[i] === "]") {
      const candidate = s.slice(0, i + 1);
      try {
        const obj = JSON.parse(candidate);
        if (typeof obj === "object" && obj !== null) {
          console.warn(`[analyze-script] JSON 尾部裁剪修复成功（裁掉 ${s.length - i - 1} 字符）`);
          return obj;
        }
      } catch { /* keep trying */ }
    }
  }

  console.error("[analyze-script] JSON 7步修复全部失败，原始内容前300字:", s.slice(0, 300));
  return null;
}

/**
 * POST /api/analyze-script
 * AI analyzes a script and determines how many nine-grid images (beat boards)
 * are needed to fully express the story. Returns a structured plan.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, settings, customPrompt } = body;

    const apiKey = settings?.["llm-key"] || "";
    const baseUrl = settings?.["llm-url"] || "https://api.geeknow.top/v1";
    const model = settings?.["llm-model"] || "gemini-2.5-pro";
    const isResponsesApi = (settings?.["llm-provider"] || "") === "dashscope-responses";

    if (!apiKey) {
      return NextResponse.json({ error: "未配置 LLM API Key" }, { status: 400 });
    }
    if (!text || text.length < 20) {
      return NextResponse.json({ error: "剧本内容过短" }, { status: 400 });
    }

    let url = baseUrl.replace(/\/+$/, "");
    if (isResponsesApi) {
      if (!url.endsWith("/responses")) url += "/responses";
    } else {
      if (!url.includes("/chat/completions")) url += "/chat/completions";
    }

    // 优先使用用户自定义提示词（来自提示词编辑页），否则使用默认提示词
    const systemPrompt = (customPrompt && customPrompt.length > 50) ? customPrompt : ANALYZE_SCRIPT_PROMPT;

    // 动态估算集数：短剧本 1-2 集，中等 3-5 集，长剧本 6-12 集
    const textLen = text.length;
    const estimatedEps = Math.max(1, Math.min(12, Math.ceil(textLen / 800)));

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `请分析以下章节剧本（约${textLen}字）。根据剧情密度和叙事节奏，将其拆分为约 ${estimatedEps} 集（每集=1张九宫格=9个关键画面），并为每集规划9个格子的画面内容。如果剧情内容较少，可以少于 ${estimatedEps} 集；如果剧情非常丰富，也可以适当增加。\n\n${text}` },
    ];

    // 根据预估集数动态调整 max_tokens：每集约 2000~3000 tokens，留足余量
    const dynamicMaxTokens = Math.max(16384, Math.min(65536, estimatedEps * 4000));
    const fetchBody = isResponsesApi
      ? { model, input: messages, max_output_tokens: dynamicMaxTokens, temperature: 0.3, stream: true }
      : { model, messages, max_tokens: dynamicMaxTokens, temperature: 0.3, stream: true };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(fetchBody),
      signal: AbortSignal.timeout(240000), // 240s — thinking 模型需要较长时间
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `API 错误 (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    // Collect streaming response
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("event:")) continue;
        let jsonStr = trimmed;
        if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
        else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
        if (jsonStr === "[DONE]") continue;
        try {
          const chunk = JSON.parse(jsonStr);
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) content += chunk.delta;
          } else {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          }
        } catch { /* skip non-JSON lines */ }
      }
    }

    // ★ 修复 A-2：flush 残留 buffer（最后一个 SSE 数据块可能未以 \n 结尾）
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      let lastJson = trimmed;
      if (trimmed.startsWith("data: ")) lastJson = trimmed.slice(6);
      else if (trimmed.startsWith("data:")) lastJson = trimmed.slice(5);
      if (lastJson && lastJson !== "[DONE]") {
        try {
          const chunk = JSON.parse(lastJson);
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) content += chunk.delta;
          } else {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          }
        } catch { /* skip */ }
      }
    }

    // Parse JSON — 增强解析：先 markdown code block，再 JSON 对象提取
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const objStart = jsonStr.indexOf("{");
    const objEnd = jsonStr.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      jsonStr = jsonStr.slice(objStart, objEnd + 1);
    }

    // ★ 7 步 JSON 修复（防止 AI 输出截断/格式异常导致 422）
    const repaired = repairAnalysisJson(jsonStr);
    if (!repaired) {
      return NextResponse.json(
        { error: "AI返回格式异常（JSON 修复失败），请重试", raw: content.slice(0, 300) },
        { status: 422 }
      );
    }

    try {
      const result = repaired;

      // ★ 服务端验证：确保返回结构合法 + beats 标准化为 9 格
      if (!result.plan || !Array.isArray(result.plan)) {
        return NextResponse.json({ error: "AI 返回结果缺少 plan 数组" }, { status: 422 });
      }
      for (const ep of result.plan) {
        if (!ep.episodeId) ep.episodeId = `ep${String(result.plan.indexOf(ep) + 1).padStart(2, "0")}`;
        if (!ep.title) ep.title = `第${result.plan.indexOf(ep) + 1}集`;
        if (!ep.description) ep.description = "";
        if (!Array.isArray(ep.scenes)) ep.scenes = [];
        if (!Array.isArray(ep.beats)) ep.beats = [];
        // 标准化为 9 格：不足补空，超出截断
        while (ep.beats.length < 9) ep.beats.push(`格${ep.beats.length + 1}：（空）`);
        if (ep.beats.length > 9) ep.beats = ep.beats.slice(0, 9);
      }
      if (typeof result.totalNineGrids !== "number") {
        result.totalNineGrids = result.plan.length;
      }
      if (!result.reasoning) result.reasoning = "";

      return NextResponse.json(result);
    } catch (parseErr) {
      console.error("[analyze-script] 结果处理异常:", parseErr);
      return NextResponse.json(
        { error: "AI返回结果处理异常，请重试", raw: content.slice(0, 300) },
        { status: 422 }
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
