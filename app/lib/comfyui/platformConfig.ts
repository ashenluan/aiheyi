export type ComfyUiPlatformKey = 'runninghub' | 'liblib' | 'thirdparty';
export type ComfyUiNodeMappingRole = 'prompt' | 'refImage' | 'output';

export interface ComfyUiWorkflowNodeMapping {
  role: ComfyUiNodeMappingRole;
  nodeId: string;
  field: string;
  nodeType?: string;
}

export interface ComfyUiPlatformWorkflowMeta {
  workflowId: string;
  workflowName?: string;
  verified: boolean;
  nodeCount?: number;
  inputCount?: number;
}

export interface ComfyUiPlatformChannelConfig {
  apiKey: string;
  workflow: ComfyUiPlatformWorkflowMeta;
  nodeMappings: ComfyUiWorkflowNodeMapping[];
}

export interface ComfyUiThirdPartyWorkflowConfig {
  workflow: ComfyUiPlatformWorkflowMeta;
  nodeMappings: ComfyUiWorkflowNodeMapping[];
}

export interface ComfyUiWorkflowPreset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  runs: string;
  platform: ComfyUiPlatformKey;
  workflowId: string;
  nodeMappings: ComfyUiWorkflowNodeMapping[];
}

export interface ComfyUiOfficialSettings {
  activePlatform: ComfyUiPlatformKey;
  runninghub: ComfyUiPlatformChannelConfig;
  liblib: ComfyUiPlatformChannelConfig;
  thirdparty: ComfyUiThirdPartyWorkflowConfig;
  customPresets: ComfyUiWorkflowPreset[];
  activePresetId?: string;
}

function createWorkflowMeta(): ComfyUiPlatformWorkflowMeta {
  return {
    workflowId: '',
    verified: false,
  };
}

function createChannelConfig(): ComfyUiPlatformChannelConfig {
  return {
    apiKey: '',
    workflow: createWorkflowMeta(),
    nodeMappings: [],
  };
}

export const COMFY_UI_PLATFORM_OPTIONS: Array<{ key: ComfyUiPlatformKey; label: string }> = [
  { key: 'runninghub', label: 'RunningHub' },
  { key: 'liblib', label: 'LiblibAI' },
  { key: 'thirdparty', label: '第三方算力 (AutoDL / 潞晨云)' },
];

export const COMFY_UI_BUILTIN_PRESETS: ComfyUiWorkflowPreset[] = [
  {
    id: 'sdxl-txt2img',
    name: 'SDXL 文生图',
    description: '标准 SDXL 1.0 文本到图片工作流\n支持 LoRA / ControlNet',
    tags: ['SDXL', 'txt2img'],
    runs: '12.5k',
    platform: 'runninghub',
    workflowId: '',
    nodeMappings: [
      { role: 'prompt', nodeId: '6', field: 'text', nodeType: 'CLIPTextEncode' },
      { role: 'output', nodeId: '9', field: 'images', nodeType: 'SaveImage' },
    ],
  },
  {
    id: 'flux-img2img',
    name: 'Flux.1 图生图',
    description: 'Flux.1 Dev 图片到图片转换\n风格迁移 / 局部重绘',
    tags: ['Flux', 'img2img'],
    runs: '8.2k',
    platform: 'runninghub',
    workflowId: '',
    nodeMappings: [
      { role: 'prompt', nodeId: '6', field: 'text', nodeType: 'CLIPTextEncode' },
      { role: 'refImage', nodeId: '3', field: 'image', nodeType: 'LoadImage' },
      { role: 'output', nodeId: '9', field: 'images', nodeType: 'SaveImage' },
    ],
  },
  {
    id: 'hunyuan-video',
    name: 'HunYuan 视频生成',
    description: '混元 DiT 视频生成工作流\n图生视频 / 文生视频',
    tags: ['HunYuan', 'video'],
    runs: '5.7k',
    platform: 'thirdparty',
    workflowId: '',
    nodeMappings: [
      { role: 'prompt', nodeId: '6', field: 'text', nodeType: 'CLIPTextEncode' },
      { role: 'refImage', nodeId: '3', field: 'image', nodeType: 'LoadImage' },
      { role: 'output', nodeId: '12', field: 'video', nodeType: 'SaveVideo' },
    ],
  },
];

export function createDefaultOfficialComfyUiSettings(): ComfyUiOfficialSettings {
  return {
    activePlatform: 'runninghub',
    runninghub: createChannelConfig(),
    liblib: createChannelConfig(),
    thirdparty: {
      workflow: createWorkflowMeta(),
      nodeMappings: [],
    },
    customPresets: [],
  };
}

export function parseWorkflowIdFromInput(value: string): string {
  const raw = value.trim();
  if (!raw) return '';

  const runninghub = raw.match(/runninghub\.cn\/(?:task|comfyui\/workflow)\/([a-zA-Z0-9_-]+)/i);
  if (runninghub) return runninghub[1];

  const liblib = raw.match(/liblib\.(?:art|ai)\/workflow\/([a-zA-Z0-9_-]+)/i);
  if (liblib) return liblib[1];

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || raw;
    } catch {
      return raw;
    }
  }

  return raw;
}

function findFieldName(inputs: Record<string, unknown>, preferred: string[], fallback = ''): string {
  for (const name of preferred) {
    if (name in inputs) return name;
  }
  return Object.keys(inputs)[0] || fallback;
}

export function detectNodeMappingsFromWorkflow(workflow: unknown): ComfyUiWorkflowNodeMapping[] {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return [];

  const mappings: ComfyUiWorkflowNodeMapping[] = [];
  const entries = Object.entries(workflow as Record<string, unknown>);

  for (const [nodeId, nodeValue] of entries) {
    if (!nodeValue || typeof nodeValue !== 'object' || Array.isArray(nodeValue)) continue;
    const node = nodeValue as { class_type?: string; inputs?: Record<string, unknown> };
    const nodeType = typeof node.class_type === 'string' ? node.class_type : '';
    const inputs = node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs)
      ? node.inputs
      : {};

    if (!mappings.find((item) => item.role === 'prompt') && ['CLIPTextEncode', 'PromptInput', 'TextEncode'].includes(nodeType)) {
      mappings.push({
        role: 'prompt',
        nodeId,
        field: findFieldName(inputs, ['text', 'prompt'], 'text'),
        nodeType,
      });
      continue;
    }

    if (!mappings.find((item) => item.role === 'refImage') && ['LoadImage', 'ImageInput', 'LoadImageMask'].includes(nodeType)) {
      mappings.push({
        role: 'refImage',
        nodeId,
        field: findFieldName(inputs, ['image', 'pixels'], 'image'),
        nodeType,
      });
      continue;
    }

    if (!mappings.find((item) => item.role === 'output') && ['SaveImage', 'SaveVideo', 'PreviewImage', 'VHS_VideoCombine'].includes(nodeType)) {
      mappings.push({
        role: 'output',
        nodeId,
        field: findFieldName(inputs, ['images', 'video', 'image'], 'images'),
        nodeType,
      });
    }
  }

  const order: Record<ComfyUiNodeMappingRole, number> = { prompt: 0, refImage: 1, output: 2 };
  return mappings.sort((a, b) => order[a.role] - order[b.role]);
}
