import { randomUUID } from "crypto";
import { comfyUiExampleWorkflow } from "@/app/lib/comfyui/sampleWorkflow";
import type {
  ComfyUiCanvasConnection,
  ComfyUiCanvasModule,
  ComfyUiModuleKind,
  ComfyUiModuleTemplate,
  ComfyUiWorkflowDocument,
} from "@/app/lib/comfyui/workflowTypes";

export const COMFY_UI_MODULE_TEMPLATES: ComfyUiModuleTemplate[] = [
  {
    kind: "checkpoint",
    title: "模型加载器",
    description: "加载 checkpoint / 模型文件。",
    defaults: { ckpt_name: "model.safetensors" },
  },
  {
    kind: "positivePrompt",
    title: "正向提示词",
    description: "设置正向提示词内容。",
    defaults: { text: "masterpiece, cinematic lighting" },
  },
  {
    kind: "negativePrompt",
    title: "反向提示词",
    description: "设置反向提示词内容。",
    defaults: { text: "blurry, low quality, text, watermark" },
  },
  {
    kind: "latentImage",
    title: "空 Latent",
    description: "声明出图尺寸与 batch。",
    defaults: { width: "1024", height: "1024", batch_size: "1" },
  },
  {
    kind: "ksampler",
    title: "KSampler",
    description: "核心采样器节点。",
    defaults: {
      seed: "0",
      steps: "28",
      cfg: "7",
      sampler_name: "euler",
      scheduler: "normal",
      denoise: "1",
    },
  },
  {
    kind: "vaeDecode",
    title: "VAE 解码",
    description: "把 latent 解码为图像。",
    defaults: {},
  },
  {
    kind: "saveImage",
    title: "保存图像",
    description: "最终存图节点。",
    defaults: { filename_prefix: "heyi-comfyui" },
  },
  {
    kind: "loadImage",
    title: "加载参考图",
    description: "为图生图或控制链加载输入图。",
    defaults: { image: "input.png" },
  },
];

export function createCanvasModule(kind: ComfyUiModuleKind): ComfyUiCanvasModule {
  const template = COMFY_UI_MODULE_TEMPLATES.find((item) => item.kind === kind);
  if (!template) {
    throw new Error(`未知模块类型: ${kind}`);
  }

  return {
    id: `${kind}-${randomUUID().slice(0, 8)}`,
    kind,
    title: template.title,
    config: { ...template.defaults },
  };
}

export function createStarterWorkflowDocument(name = "新建工作流"): ComfyUiWorkflowDocument {
  const modules = [
    createCanvasModule("checkpoint"),
    createCanvasModule("positivePrompt"),
    createCanvasModule("negativePrompt"),
    createCanvasModule("latentImage"),
    createCanvasModule("ksampler"),
    createCanvasModule("vaeDecode"),
    createCanvasModule("saveImage"),
  ];

  const connections: ComfyUiCanvasConnection[] = [
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[0].id, toModuleId: modules[4].id, label: "model" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[1].id, toModuleId: modules[4].id, label: "positive" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[2].id, toModuleId: modules[4].id, label: "negative" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[3].id, toModuleId: modules[4].id, label: "latent_image" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[4].id, toModuleId: modules[5].id, label: "samples" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[0].id, toModuleId: modules[5].id, label: "vae" },
    { id: `edge-${randomUUID().slice(0, 8)}`, fromModuleId: modules[5].id, toModuleId: modules[6].id, label: "images" },
  ];

  return {
    id: `workflow-${randomUUID().slice(0, 8)}`,
    name,
    description: "基础文生图骨架，可继续扩展节点和平台参数。",
    platform: "local",
    workflowId: "",
    serverId: null,
    modules,
    connections,
    workflowText: JSON.stringify(comfyUiExampleWorkflow, null, 2),
    updatedAt: new Date().toISOString(),
  };
}

export function buildWorkflowTextFromCanvas(doc: ComfyUiWorkflowDocument): string {
  const ids = new Map<string, string>();
  doc.modules.forEach((module, index) => {
    ids.set(module.id, String(index + 1));
  });

  const nodeByKind = new Map<ComfyUiModuleKind, ComfyUiCanvasModule>();
  for (const module of doc.modules) {
    if (!nodeByKind.has(module.kind)) {
      nodeByKind.set(module.kind, module);
    }
  }

  const checkpoint = nodeByKind.get("checkpoint");
  const positive = nodeByKind.get("positivePrompt");
  const negative = nodeByKind.get("negativePrompt");
  const latent = nodeByKind.get("latentImage");
  const sampler = nodeByKind.get("ksampler");
  const vaeDecode = nodeByKind.get("vaeDecode");
  const saveImage = nodeByKind.get("saveImage");
  const loadImage = nodeByKind.get("loadImage");

  const workflow: Record<string, unknown> = {};

  if (checkpoint) {
    workflow[ids.get(checkpoint.id)!] = {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpoint.config.ckpt_name || "model.safetensors",
      },
      _meta: { title: checkpoint.title },
    };
  }

  if (positive && checkpoint) {
    workflow[ids.get(positive.id)!] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: positive.config.text || "masterpiece, cinematic lighting",
        clip: [ids.get(checkpoint.id)!, 1],
      },
      _meta: { title: positive.title },
    };
  }

  if (negative && checkpoint) {
    workflow[ids.get(negative.id)!] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negative.config.text || "blurry, low quality, text, watermark",
        clip: [ids.get(checkpoint.id)!, 1],
      },
      _meta: { title: negative.title },
    };
  }

  if (latent) {
    workflow[ids.get(latent.id)!] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: Number(latent.config.width || 1024),
        height: Number(latent.config.height || 1024),
        batch_size: Number(latent.config.batch_size || 1),
      },
      _meta: { title: latent.title },
    };
  }

  if (loadImage) {
    workflow[ids.get(loadImage.id)!] = {
      class_type: "LoadImage",
      inputs: {
        image: loadImage.config.image || "input.png",
      },
      _meta: { title: loadImage.title },
    };
  }

  if (sampler && checkpoint && positive && negative && latent) {
    workflow[ids.get(sampler.id)!] = {
      class_type: "KSampler",
      inputs: {
        seed: Number(sampler.config.seed || 0),
        steps: Number(sampler.config.steps || 28),
        cfg: Number(sampler.config.cfg || 7),
        sampler_name: sampler.config.sampler_name || "euler",
        scheduler: sampler.config.scheduler || "normal",
        denoise: Number(sampler.config.denoise || 1),
        model: [ids.get(checkpoint.id)!, 0],
        positive: [ids.get(positive.id)!, 0],
        negative: [ids.get(negative.id)!, 0],
        latent_image: [ids.get(latent.id)!, 0],
      },
      _meta: { title: sampler.title },
    };
  }

  if (vaeDecode && sampler && checkpoint) {
    workflow[ids.get(vaeDecode.id)!] = {
      class_type: "VAEDecode",
      inputs: {
        samples: [ids.get(sampler.id)!, 0],
        vae: [ids.get(checkpoint.id)!, 2],
      },
      _meta: { title: vaeDecode.title },
    };
  }

  if (saveImage && vaeDecode) {
    workflow[ids.get(saveImage.id)!] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: saveImage.config.filename_prefix || "heyi-comfyui",
        images: [ids.get(vaeDecode.id)!, 0],
      },
      _meta: { title: saveImage.title },
    };
  }

  return JSON.stringify(workflow, null, 2);
}
