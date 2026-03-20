export const comfyUiExampleWorkflow = {
  "1": {
    inputs: {
      ckpt_name: "replace-with-your-checkpoint.safetensors",
    },
    class_type: "CheckpointLoaderSimple",
  },
  "2": {
    inputs: {
      text: "cinematic storyboard frame, polished composition, dramatic lighting, richly detailed environment, single decisive camera angle",
      clip: ["1", 1],
    },
    class_type: "CLIPTextEncode",
  },
  "3": {
    inputs: {
      text: "blurry, deformed, low detail, extra limbs, broken anatomy, unreadable composition",
      clip: ["1", 1],
    },
    class_type: "CLIPTextEncode",
  },
  "4": {
    inputs: {
      width: 1024,
      height: 576,
      batch_size: 1,
    },
    class_type: "EmptyLatentImage",
  },
  "5": {
    inputs: {
      seed: 123456789,
      steps: 24,
      cfg: 7.5,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
    },
    class_type: "KSampler",
  },
  "6": {
    inputs: {
      samples: ["5", 0],
      vae: ["1", 2],
    },
    class_type: "VAEDecode",
  },
  "7": {
    inputs: {
      filename_prefix: "FEICAI/ComfyUI/storyboard",
      images: ["6", 0],
    },
    class_type: "SaveImage",
  },
} as const;
