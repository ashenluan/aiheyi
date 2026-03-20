import { NextResponse } from "next/server";
import {
  deleteCustomPreset,
  getCustomPresetFilePath,
  readCustomPresetStore,
  upsertCustomPreset,
  writeCustomPresetStore,
  type CustomPresetType,
} from "@/app/lib/customPresets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const store = readCustomPresetStore();
    const presets = type
      ? store.presets.filter((preset) => preset.type === type)
      : store.presets;
    return NextResponse.json({
      presets,
      updatedAt: store.updatedAt,
      filePath: getCustomPresetFilePath(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const type = String(body.type || "other") as CustomPresetType;
    const label = String(body.label || "").trim();
    const payload = body.payload;
    if (!label || !payload || typeof payload !== "object") {
      return NextResponse.json({ error: "需要提供 label 和 payload" }, { status: 400 });
    }

    const store = upsertCustomPreset({
      id: typeof body.id === "string" ? body.id : undefined,
      type,
      label,
      payload: payload as Record<string, unknown>,
      note: typeof body.note === "string" ? body.note : undefined,
    });

    return NextResponse.json({
      success: true,
      presets: store.presets,
      updatedAt: store.updatedAt,
      filePath: getCustomPresetFilePath(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const presets = Array.isArray(body.presets) ? body.presets : null;
    if (!presets) {
      return NextResponse.json({ error: "需要提供 presets 数组" }, { status: 400 });
    }
    const store = writeCustomPresetStore({
      presets,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({
      success: true,
      presets: store.presets,
      updatedAt: store.updatedAt,
      filePath: getCustomPresetFilePath(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      const store = writeCustomPresetStore({ presets: [], updatedAt: new Date().toISOString() });
      return NextResponse.json({
        success: true,
        presets: store.presets,
        updatedAt: store.updatedAt,
        filePath: getCustomPresetFilePath(),
      });
    }

    const store = deleteCustomPreset(id);
    return NextResponse.json({
      success: true,
      presets: store.presets,
      updatedAt: store.updatedAt,
      filePath: getCustomPresetFilePath(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
