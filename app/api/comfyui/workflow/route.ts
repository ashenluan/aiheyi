import { NextResponse } from "next/server";
import { requireLicense } from "@/app/lib/license/requireLicense";
import { getComfyUiWorkflowFilePath, getComfyUiWorkflowStore, saveComfyUiWorkflowStore } from "@/app/lib/comfyui/workflowStore";
import type { ComfyUiWorkflowStore } from "@/app/lib/comfyui/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const license = await requireLicense();
  if (license) return license;

  try {
    const store = getComfyUiWorkflowStore();
    return NextResponse.json({
      ...store,
      configFile: getComfyUiWorkflowFilePath(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "读取 ComfyUI 工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const license = await requireLicense();
  if (license) return license;

  try {
    const body = await request.json();
    const workflows = Array.isArray(body.workflows) ? body.workflows : [];
    const activeWorkflowId = typeof body.activeWorkflowId === "string" ? body.activeWorkflowId : null;
    const store = saveComfyUiWorkflowStore({ workflows, activeWorkflowId } as Partial<ComfyUiWorkflowStore>);
    return NextResponse.json({
      ...store,
      configFile: getComfyUiWorkflowFilePath(),
      success: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "保存 ComfyUI 工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
