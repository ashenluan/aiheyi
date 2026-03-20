import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";
import { saveProvenanceManifest } from "@/app/lib/provenance/server";
import type { CreateProvenanceManifestInput } from "@/app/lib/provenance/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireLicense();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Partial<CreateProvenanceManifestInput>;
    if (!body.kind || !body.title || !body.stage || !body.episode || !Array.isArray(body.outputs)) {
      return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
    }

    const { filename, manifest } = saveProvenanceManifest({
      kind: body.kind,
      title: body.title,
      stage: body.stage,
      episode: body.episode,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      model: body.model && typeof body.model === "object" ? body.model : undefined,
      inputs: body.inputs && typeof body.inputs === "object" ? body.inputs : undefined,
      outputs: body.outputs,
      context: body.context && typeof body.context === "object" ? body.context : undefined,
    });

    return NextResponse.json({ ok: true, filename, manifest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
