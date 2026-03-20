export type WorkflowHandoffStatus = "ready" | "needs-attention" | "blocked";

export interface WorkflowHandoffItem {
  id: string;
  label: string;
  detail: string;
  status: WorkflowHandoffStatus;
  actionLabel?: string;
  href?: string;
}

export interface WorkflowHandoffChecklist {
  stageLabel: string;
  title: string;
  description: string;
  summary: string;
  items: WorkflowHandoffItem[];
}

interface PipelineToStudioInput {
  episode: string;
  episodes: string[];
  hasPipelineContext: boolean;
  ninePromptCount: number;
  smartNinePromptCount: number;
  fourGroupReadyCount: number;
  imageGenMode: "api" | "geminiTab" | "jimeng";
}

interface StudioToVideoInput {
  episode: string;
  episodes: string[];
  mode: "single" | "firstlast" | "multiref" | "batchRelay";
  selectedGridLabel: string;
  selectedSourceReady: boolean;
  sourceImageCount: number;
  firstFrameReady: boolean;
  lastFrameReady: boolean;
  refImageCount: number;
  currentPromptLength: number;
  selectedModelName: string;
  selectedModelReady: boolean;
  selectedModelSupportsMode: boolean;
  readyVideoCount: number;
}

function countReady(items: WorkflowHandoffItem[]) {
  return items.filter((item) => item.status === "ready").length;
}

export function buildPipelineToStudioChecklist(
  input: PipelineToStudioInput,
): WorkflowHandoffChecklist {
  const promptCount = input.ninePromptCount + input.smartNinePromptCount;
  const hasEpisode = Boolean(input.episode && input.episodes.includes(input.episode));
  const currentModeDetail =
    input.imageGenMode === "geminiTab"
      ? "当前使用 Gemini Tab 生图，建议先确认浏览器服务在线"
      : input.imageGenMode === "jimeng"
        ? "当前使用即梦链路，建议先确认凭证与任务配额"
        : "当前使用 API 生图，可直接继续九宫格或四宫格出图";

  const items: WorkflowHandoffItem[] = [
    {
      id: "episode",
      label: "当前分集",
      detail: hasEpisode
        ? `已锁定 ${input.episode.toUpperCase()}，可继续在当前分集出图`
        : "当前还没有可用分集，建议先回流水线准备分镜数据",
      status: hasEpisode ? "ready" : "blocked",
      actionLabel: hasEpisode ? "查看流水线" : "回到流水线",
      href: "/pipeline",
    },
    {
      id: "context",
      label: "剧本上下文",
      detail: input.hasPipelineContext
        ? "当前会话已绑定剧本或章节来源，后续分镜结果可继续溯源"
        : "当前会话未检测到剧本绑定，虽然仍可出图，但建议先回剧本或流水线确认来源",
      status: input.hasPipelineContext ? "ready" : "needs-attention",
      actionLabel: input.hasPipelineContext ? "查看剧本" : "去补剧本",
      href: "/scripts",
    },
    {
      id: "storyboard",
      label: "分镜提示词",
      detail: promptCount > 0
        ? `已接入 ${promptCount} 条分镜提示词，其中智能分镜 ${input.smartNinePromptCount} 条`
        : "还没有九宫格分镜提示词，建议先在流水线完成节拍拆解或智能分镜",
      status: promptCount > 0 ? "ready" : "blocked",
      actionLabel: promptCount > 0 ? "查看流水线" : "去生成提示词",
      href: "/pipeline",
    },
    {
      id: "four-groups",
      label: "四宫格展开",
      detail: input.fourGroupReadyCount > 0
        ? `已有 ${input.fourGroupReadyCount} 组四宫格展开提示词，可直接继续细化画面`
        : "当前还没有四宫格展开提示词，后续可在当前页继续生成或补齐",
      status: input.fourGroupReadyCount > 0 ? "ready" : "needs-attention",
      actionLabel: "查看流水线",
      href: "/pipeline",
    },
    {
      id: "image-mode",
      label: "当前生图通道",
      detail: currentModeDetail,
      status: input.imageGenMode === "api" ? "ready" : "needs-attention",
      actionLabel: "打开设置",
      href: "/settings",
    },
  ];

  return {
    stageLabel: "Pipeline -> Studio",
    title: "阶段交接检查单",
    description: "先确认分镜来源、提示词和当前出图通道，再进入九宫格或四宫格生成。",
    summary: `已就绪 ${countReady(items)}/${items.length} 项`,
    items,
  };
}

export function buildStudioToVideoChecklist(
  input: StudioToVideoInput,
): WorkflowHandoffChecklist {
  const hasEpisode = Boolean(input.episode && input.episodes.includes(input.episode));

  let sourceDetail = "";
  let sourceStatus: WorkflowHandoffStatus = "needs-attention";

  if (input.mode === "single") {
    sourceStatus = input.selectedSourceReady ? "ready" : "blocked";
    sourceDetail = input.selectedSourceReady
      ? `已选择 ${input.selectedGridLabel} 作为当前源图，可直接生成单图视频`
      : "当前组还没有选定源图，建议先从四宫格导入或上传一张图";
  } else if (input.mode === "firstlast") {
    sourceStatus = input.firstFrameReady ? "ready" : "blocked";
    sourceDetail = input.firstFrameReady
      ? (input.lastFrameReady ? "首尾帧都已准备好，可直接生成过渡视频" : "首帧已准备好，尾帧可留空由模型自由发挥")
      : "首尾帧模式至少需要一张首帧图片";
  } else if (input.mode === "multiref") {
    sourceStatus = input.refImageCount > 0 ? "ready" : "blocked";
    sourceDetail = input.refImageCount > 0
      ? `已准备 ${input.refImageCount} 张参考图，可继续做多参考视频`
      : "多参考模式还没有参考图，建议先从 Studio 导入角色或分镜图片";
  } else {
    sourceStatus = input.sourceImageCount >= 4 ? "ready" : "blocked";
    sourceDetail = input.sourceImageCount >= 4
      ? "A/B/C/D 四张接力源图已齐，可以继续做批量接力"
      : `当前只准备了 ${input.sourceImageCount}/4 张接力图，批量接力还不能开始`;
  }

  const items: WorkflowHandoffItem[] = [
    {
      id: "episode",
      label: "当前分集",
      detail: hasEpisode
        ? `当前正在处理 ${input.episode.toUpperCase()}`
        : "当前分集未就绪，建议先回 Studio 或流水线确认分集",
      status: hasEpisode ? "ready" : "blocked",
      actionLabel: hasEpisode ? "回到 Studio" : "去 Studio",
      href: "/studio",
    },
    {
      id: "source",
      label: "源图素材",
      detail: sourceDetail,
      status: sourceStatus,
      actionLabel: sourceStatus === "ready" ? "查看 Studio" : "去补源图",
      href: "/studio",
    },
    {
      id: "prompt",
      label: "动态提示词",
      detail: input.currentPromptLength > 0
        ? `已准备 ${input.currentPromptLength} 字的动态提示词，可直接送入模型`
        : "当前还没有动态提示词，可以先手写，也可以用 AI 生成补齐",
      status: input.currentPromptLength > 0 ? "ready" : "needs-attention",
      actionLabel: "留在当前页",
      href: "/video",
    },
    {
      id: "model",
      label: "视频模型",
      detail: input.selectedModelReady
        ? (input.selectedModelSupportsMode
            ? `当前模型 ${input.selectedModelName} 已可用`
            : `当前模型 ${input.selectedModelName} 不支持该模式，请切换模型或模式`)
        : `当前模型 ${input.selectedModelName || "未配置"} 还不可用，请先在设置页补齐配置`,
      status: input.selectedModelReady && input.selectedModelSupportsMode ? "ready" : "blocked",
      actionLabel: "打开设置",
      href: "/settings",
    },
    {
      id: "outputs",
      label: "样片产出",
      detail: input.readyVideoCount > 0
        ? `当前分集已有 ${input.readyVideoCount} 个可用视频样片`
        : "当前还没有生成好的样片，建议先打出一条用于回看节奏和质感",
      status: input.readyVideoCount > 0 ? "ready" : "needs-attention",
      actionLabel: input.readyVideoCount > 0 ? "查看产出" : "继续生成",
      href: input.readyVideoCount > 0 ? "/outputs" : "/video",
    },
  ];

  return {
    stageLabel: "Studio -> Video",
    title: "阶段交接检查单",
    description: "先确认源图、动态提示词和视频模型，再开始批量生成或导出样片。",
    summary: `已就绪 ${countReady(items)}/${items.length} 项`,
    items,
  };
}
