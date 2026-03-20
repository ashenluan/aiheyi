"use client";

export type PromptLanguage = "zh" | "en" | "both";

export interface VideoPromptProfile {
  id: string;
  label: string;
  matchPattern: RegExp;
  maxLength: number;
  language: PromptLanguage;
  minDuration: number;
  maxDuration: number;
  systemPromptPatch: string;
}

const GENERIC_PATCH = `## 目标平台：通用
- 中英文混合
- 长度控制在 50-300 字符
- 使用通用的镜头语言和动作描述
- 兼顾各平台的共性偏好`;

const VIDEO_PROMPT_PROFILES: VideoPromptProfile[] = [
  {
    id: "generic",
    label: "通用模式",
    matchPattern: /.*/,
    maxLength: 1500,
    language: "both",
    minDuration: 3,
    maxDuration: 15,
    systemPromptPatch: GENERIC_PATCH,
  },
  {
    id: "sora",
    label: "OpenAI Sora",
    matchPattern: /^sora/i,
    maxLength: 1500,
    language: "both",
    minDuration: 5,
    maxDuration: 25,
    systemPromptPatch: `## 目标平台：OpenAI Sora
- 偏好简洁自然语言，避免过度技术化
- 长度控制在 100-500 字符
- 注重物理真实性描述（重力、惯性、碰撞等）
- 用英文或中英混合`,
  },
  {
    id: "veo",
    label: "Google Veo 3.1",
    matchPattern: /^veo|google\s*veo/i,
    maxLength: 2000,
    language: "both",
    minDuration: 4,
    maxDuration: 20,
    systemPromptPatch: `## 目标平台：Google Veo 3.1
- 偏好电影化镜头语言（cinematic language）
- 支持较长提示词（最多 2000 字符）
- 中英文混合，关键镜头术语用英文（dolly in, tracking shot, crane up 等）
- 对光影、色彩渐变描述敏感`,
  },
  {
    id: "kling",
    label: "可灵 Kling",
    matchPattern: /^kling|可灵/i,
    maxLength: 1200,
    language: "zh",
    minDuration: 4,
    maxDuration: 20,
    systemPromptPatch: `## 目标平台：可灵 Kling
- 中文友好，优先使用中文描述
- 长度控制在 80-500 字符
- 支持运动强度控制，提示词中注明节奏（快速、缓慢、停顿）
- 对人物动作和表情变化描述效果好`,
  },
  {
    id: "hailuo",
    label: "海螺 MiniMax Hailuo",
    matchPattern: /^hailuo|^minimax|海螺/i,
    maxLength: 1200,
    language: "zh",
    minDuration: 4,
    maxDuration: 15,
    systemPromptPatch: `## 目标平台：海螺 MiniMax Hailuo
- 中文原生，偏好叙事性描述
- 长度控制在 80-400 字符
- 偏好分步骤的动态描述
- 对场景转换和光影变化效果好`,
  },
  {
    id: "runway",
    label: "Runway Gen",
    matchPattern: /^runway|^gen-?4/i,
    maxLength: 1000,
    language: "en",
    minDuration: 4,
    maxDuration: 12,
    systemPromptPatch: `## 目标平台：Runway Gen
- 英文输出
- 长度控制在 50-300 字符
- 强调核心动作，每段提示词聚焦 1-2 个关键变化
- 镜头语言简明扼要`,
  },
  {
    id: "grok",
    label: "Grok Video",
    matchPattern: /^grok/i,
    maxLength: 1200,
    language: "en",
    minDuration: 4,
    maxDuration: 15,
    systemPromptPatch: `## 目标平台：Grok Video
- 英文或中英混合
- 长度控制在 50-300 字符
- 偏好艺术化、风格化描述
- 关键词式表达效果好（词组用逗号分隔）`,
  },
  {
    id: "wan",
    label: "阿里万象 Wan 2.6",
    matchPattern: /^wan|万象/i,
    maxLength: 1400,
    language: "zh",
    minDuration: 4,
    maxDuration: 15,
    systemPromptPatch: `## 目标平台：阿里万象 Wan 2.6
- 中文友好
- 长度控制在 50-450 字，硬限 700 字
- 动作描述具体化，避免抽象概念
- 场景描述优先于镜头术语`,
  },
  {
    id: "seedance",
    label: "即梦 Seedance（豆包）",
    matchPattern: /^seedance|^jimeng|即梦|豆包/i,
    maxLength: 1400,
    language: "zh",
    minDuration: 3,
    maxDuration: 15,
    systemPromptPatch: `## 目标平台：即梦 Seedance（豆包）
- 提示词使用中文
- 长度控制在 50-450 字，硬限 700 字
- 禁止血腥暴力、自残、色情、恐怖、政治敏感内容
- 如遇暴力描写，自动替换为温和表述`,
  },
];

export function resolveVideoPromptProfile(modelName?: string): VideoPromptProfile {
  if (!modelName) return VIDEO_PROMPT_PROFILES[0];
  for (const profile of VIDEO_PROMPT_PROFILES.slice(1)) {
    if (profile.matchPattern.test(modelName)) return profile;
  }
  return VIDEO_PROMPT_PROFILES[0];
}

export function formatPromptLanguage(language: PromptLanguage): string {
  if (language === "zh") return "中文";
  if (language === "en") return "英文";
  return "中英混合";
}
