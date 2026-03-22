import { NextResponse } from "next/server";

import { COSTUME_DESIGN_PROMPT } from "@/app/lib/defaultPrompts";
import { requireLicense } from "@/app/lib/license/requireLicense";

export const dynamic = "force-dynamic";

interface CostumeVariant {
  id: string;
  label: string;
  prompt: string;
  notes: string;
}

function buildVariantPrompt(
  characterName: string,
  worldSetting: string,
  outfitBrief: string,
  stylePrompt: string,
  variantLabel: string,
  emphasis: string,
  lockComposition: boolean,
  referenceHint: string,
  customPrompt: string,
) {
  return [
    customPrompt || COSTUME_DESIGN_PROMPT,
    `${characterName}, haute couture costume design sheet`,
    worldSetting || "cinematic worldbuilding with coherent era aesthetics",
    outfitBrief || "signature outfit design aligned with the character arc",
    variantLabel,
    emphasis,
    stylePrompt || "premium concept art, couture tailoring, museum-grade textile detail",
    "six-layer costume detailing: silhouette, fabric, craftsmanship, accessories, color logic, motion behavior",
    "front view, back view, three-quarter view, material callouts, accessory close-ups",
    "80-120 words of dense English visual design direction, no subtitles, no watermark, no readable text",
    lockComposition
      ? `preserve original composition, camera angle, character pose, framing, lighting rhythm, and background structure${referenceHint ? `, reference: ${referenceHint}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      characterName?: string;
      worldSetting?: string;
      outfitBrief?: string;
      stylePrompt?: string;
      lockComposition?: boolean;
      referenceHint?: string;
      customPrompt?: string;
    };

    const characterName = String(body.characterName || "").trim();
    if (!characterName) {
      return NextResponse.json({ error: "缺少 characterName" }, { status: 400 });
    }

    const worldSetting = String(body.worldSetting || "").trim();
    const outfitBrief = String(body.outfitBrief || "").trim();
    const stylePrompt = String(body.stylePrompt || "").trim();
    const referenceHint = String(body.referenceHint || "").trim();
    const customPrompt = String(body.customPrompt || "").trim();
    const lockComposition = body.lockComposition !== false;

    const variants: CostumeVariant[] = [
      {
        id: "hero",
        label: "主设定款",
        notes: "保留角色识别度最高的主视觉方案，适合主线剧情和标准设定图。",
        prompt: buildVariantPrompt(characterName, worldSetting, outfitBrief, stylePrompt, "hero couture look", "balanced silhouette, signature motifs, core color narrative", lockComposition, referenceHint, customPrompt),
      },
      {
        id: "battle",
        label: "战斗强化款",
        notes: "强调机动性、防护结构和动态线条，适合动作场景和高张力镜头。",
        prompt: buildVariantPrompt(characterName, worldSetting, outfitBrief, stylePrompt, "battle variant", "combat-ready tailoring, reinforced structure, aggressive accessory language", lockComposition, referenceHint, customPrompt),
      },
      {
        id: "ceremony",
        label: "仪式高定款",
        notes: "强调仪式感、层次感和奢华材质，适合海报、高光展示和典礼场景。",
        prompt: buildVariantPrompt(characterName, worldSetting, outfitBrief, stylePrompt, "ceremonial couture", "luxury fabric layers, ornate accessories, premium couture composition", lockComposition, referenceHint, customPrompt),
      },
      {
        id: "variant-lock",
        label: "构图锁定变体",
        notes: "尽量沿用原图构图、角度、姿态和背景，只替换服装设计细节。",
        prompt: buildVariantPrompt(characterName, worldSetting, outfitBrief, stylePrompt, "locked-composition variant", "match pose, lensing, framing, and background while swapping only the costume design", true, referenceHint, customPrompt),
      },
    ];

    return NextResponse.json({
      success: true,
      characterName,
      lockComposition,
      variants,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 },
    );
  }
}
