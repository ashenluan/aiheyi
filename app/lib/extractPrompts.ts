/**
 * 两阶段 AI 提取提示词定义
 *
 * Phase 1: 轻量级实体识别 — 提取所有角色/场景/道具的名称、别名、详细中文描述（150-200字）
 * Phase 2: 并发 Spec Sheet 生成 — 每个实体独立调用 LLM 生成英文 prompt（80-120词）
 *
 * ★ Phase 2 的规格表规则统一来自 refSheetPrompts.ts（单一事实来源）
 */

import {
  buildSinglePassCharacterRules,
  buildSinglePassSceneRules,
  buildSinglePassPropRules,
  buildPhase2CharacterPrompt,
  buildPhase2ScenePrompt,
  buildPhase2PropPrompt,
} from "./refSheetPrompts";

export const SINGLE_PASS_EXTRACT_PROMPT = [
  "# Role",
  "你是一位顶级好莱坞概念美术指导兼 AI 绘画提示词大师。你擅长从CG电影、游戏原画、概念设计的角度拆解视觉元素，并为每个元素生成**专业级规范设定图页面（Specification Sheet）**的英文 Prompt。",
  "",
  "# 核心质感原则（★每条 Prompt 必须贯彻★）",
  "- 所有 Prompt 必须包含电影级质感修饰词：masterpiece, best quality, ultra detailed, cinematic quality",
  "- 角色必须美观、符合大众审美：五官精致立体、皮肤细腻、发型层次分明、服装材质细节丰富（PBR材质、布料纹理、金属光泽），Prompt 必须包含 beautiful, attractive, refined facial features",
  "- 场景必须磅礴化：史诗级规模感、体积光、大气散射、环境叙事感",
  "- 道具必须精致化：微距级细节、材质质感（磨砂/抛光/氧化/腐蚀）、设计感",
  "",
  "# Extraction Rules（严格遵守）",
  "",
  "## 中英内容同步规则（★最高优先级 — 与提取范围同级★）",
  "- 每个条目的 description（中文）字段必须是对应 prompt（英文）字段的**完整逐句中文翻译版**",
  "- description 必须包含 prompt 中的全部面板布局描述、色板HEX数值、质感描述词、页面结构标注",
  "- ★ 两字段内容必须一一对应，中文不得省略英文中的任何结构信息 ★",
  "- 生成策略：先构思完整的英文 prompt → 再将英文逐句翻译为中文作为 description",
  "",
  "## 0. 提取范围规则（★最高优先级★）",
  "- 提取所有在文本中**有名字**的角色（包括仅被提及一次的次要角色）",
  "- 提取所有**有台词或对话**的角色（即使只有一句话）",
  "- 提取所有**有明确外观描述**的角色（哪怕是路人，只要文本描写了其外貌）",
  "- 不要遗漏次要角色、反派、配角、群众角色",
  "- 只有完全无名、无台词、无外观描述的纯背景人物才可以忽略",
  "- 场景和道具同理：所有有名称或有描述的场景/道具都必须提取，不得遗漏",
  "",
  buildSinglePassCharacterRules(),
  "",
  "### 角色示例（定妆规范页面格式）：",
  '  {"name": "陈凌", "aliases": ["凌", "陈队长", "队长"], "description": "角色设计参考设定图，单一深灰色背景多视角展示，专业概念美术页面布局。陈凌，英俊30岁男性，185cm精壮运动体型，短碎黑发灰白鬓角，深灰色瞳孔，棱角分明下颌线，干净深灰色修身西装，白色衬衫，黑色德比皮鞋，中性冷静表情，干净完好状态。左上面板：面部特写肖像，精致五官细节，高度细节肌肤质感带微妙毛孔，中性冷静表情，干净无瑕肌肤。色板色块：#2C2C2C, #F5F5F5, #1A1A1A, #4A4A4A, #8B7355, #E8C4A0。中央三面板：正面、四分之三侧面、背面，全身站姿并排。右侧面板：全身正面站姿配金色人体轮廓剪影标注185cm。红色粗体标题：Character: 陈凌。底部行：四个矩形细节特写面板——面部妆容、西装翻领、衬衫领口、皮鞋材质。工作室打光，8K，高度细节，单一复合图像，杰作，最佳质量，超精细。", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout. Chen Ling, handsome 30-year-old male, 185cm lean athletic build, short messy black hair with grey temples, dark grey eyes, sharp angular jawline, clean dark grey slim-fit suit, white dress shirt, black derby shoes, neutral calm expression, clean pristine condition. Red bold title: \\"Character: 陈凌\\". Top-left panel labeled \\"面部特写\\": face close-up portrait, detailed facial features, refined features, highly detailed skin texture with subtle pores, neutral calm expression, clean unblemished skin. Color palette swatches below: #2C2C2C, #F5F5F5, #1A1A1A, #4A4A4A, #8B7355, #E8C4A0. Center three panels labeled \\"正面\\" / \\"侧面\\" / \\"背面\\": front view, three-quarter view, back view, full body standing poses side by side. Right panel labeled \\"全身像\\": full body front pose with golden human silhouette height chart marked 185cm. Bottom row: four rectangular detail panels with Chinese labels — 面部妆容, 西装翻领, 衬衫领口, 皮鞋材质. Studio lighting, 8K, highly detailed, single composite image, masterpiece, best quality, ultra detailed."}',
  "",
  "### 角色形态拆分示例：",
  '  {"name": "孙悟空·石像形态", "aliases": ["石像", "石猴", "石像悟空", "猴王石像"], "description": "角色设计参考设定图，单一深灰色背景多视角展示，专业概念美术页面布局。孙悟空石像形态，巨型花岗岩猴王石像，莲台之上盘坐禅定姿态，青苔覆盖的风化裂纹，凹陷无光的眼窝，双手合十于胸前，灰褐色调。左上面板：面部特写，雕刻面部特征，凹陷眼窝，风化裂纹纹理，缝隙中的青苔。色板色块：#8B7D6B, #4A5D3C, #6B5C4D, #A09080, #3C4A35, #C0B0A0。中央三面板：正面、四分之三侧面、背面，全身姿态并排。右侧面板：全身正面配金色轮廓剪影标注300cm。红色粗体标题：Character: 孙悟空·石像形态。底部行：四个矩形细节面板——面部雕刻纹理、莲台雕纹、手臂青苔与裂纹、基座石材风化。工作室打光，8K，高度细节，单一复合图像，杰作，最佳质量，超精细。", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout. Sun Wukong stone statue form, giant granite monkey king statue, meditation pose on ornate lotus pedestal, moss-covered weathered cracks, hollow eye sockets, hands clasped at chest, grey-brown tone. Red bold title: \\"Character: 孙悟空·石像形态\\". Top-left panel labeled \\"面部特写\\": face close-up, carved facial features, hollow eye sockets, weathered crack textures, moss in crevices. Color palette swatches below: #8B7D6B, #4A5D3C, #6B5C4D, #A09080, #3C4A35, #C0B0A0. Center three panels labeled \\"正面\\" / \\"侧面\\" / \\"背面\\": front view, three-quarter view, back view, full body poses side by side. Right panel labeled \\"全身像\\": full body front with golden silhouette height chart marked 300cm. Bottom row: four rectangular detail panels with Chinese labels — 面部雕刻, 莲台雕纹, 手臂青苔, 基座风化. Studio lighting, 8K, highly detailed, single composite image, masterpiece, best quality, ultra detailed."}',
  "",
  buildSinglePassSceneRules(),
  "",
  "### 场景示例（规范页面格式）：",
  `  {"name": "地下实验室", "aliases": ["实验室", "地下室", "地底实验室"], "description": "场景设计概念美术参考设定图，单一图像多面板布局，专业页面布局，无人物。地下实验室 — Underground Laboratory。巨大洞穴式工业混凝土空间，锈蚀管道与闪烁青绿灯光。红色粗体标题：Scene: 地下实验室。顶部行：四个小缩略图——正面、侧面、俯视、低角度，各有标注。左侧列：三个纵向面板——白天（晴天）明亮顶部工业灯光、黄昏（阴天）仅应急照明、夜晚（雾天）闪烁青绿荧光与大气雾效，各有标注。中央：大尺寸主图，巨大混凝土空间，中央钢制工作台散落碎裂试管，墙面延伸锈蚀管道，青绿荧光投射不均匀阴影，尘土弥漫氛围。底部行：四个圆形细节特写——荧光灯管、锈蚀管道腐蚀纹理、开裂混凝土地面、碎裂玻璃试管，各有标注。右侧边栏：色板——主色：Deep Concrete Grey, Rust Brown, Industrial Green；辅色：Pipe Copper, Dust Beige, Shadow Black；点缀色：Cyan Fluorescent, Emergency Red。单一复合图像，高度细节，电影级打光，8K，杰作，最佳质量。", "prompt": "scene design concept art reference sheet, multiple panels on single image, professional page layout, no people, no humans. Underground Laboratory — 地下实验室. Vast cavernous industrial concrete space with corroded pipes and flickering cyan lights. Red bold title: \\"Scene: 地下实验室\\". Top row: four small thumbnails — front view, side view, top-down view, low-angle view, each labeled. Left column: three vertical panels — \\"Daytime (Clear)\\" bright overhead industrial lights, \\"Dusk (Cloudy)\\" dim emergency lighting only, \\"Night (Foggy)\\" flickering cyan fluorescent with atmospheric fog, each labeled. Center: large main image, vast concrete chamber, central steel workbench with broken test tubes, corroded rusty pipes along walls, cyan-green fluorescent casting uneven shadows, dusty atmosphere. Bottom row: four circular detail close-ups — fluorescent tube light, rusty pipe corrosion texture, cracked concrete floor, broken glass test tubes, each labeled. Right sidebar: color palette — Primary: Deep Concrete Grey, Rust Brown, Industrial Green; Secondary: Pipe Copper, Dust Beige, Shadow Black; Accent: Cyan Fluorescent, Emergency Red. Single composite image, highly detailed, cinematic lighting, 8K, masterpiece, best quality."}`,
  "",
  buildSinglePassPropRules(),
  "",
  "### 道具示例（规格参考表格式）：",
  '  {"name": "信号追踪器", "aliases": ["追踪器", "信号仪", "定位设备"], "description": "道具设计参考，道具设计规格参考表，多角度，详细物品图，标注面板，单一复合图像。红色粗体标题：Prop: 信号追踪器。巴掌大小哑光黑色阳极氧化金属设备，2英寸圆形OLED屏幕。上方一排：正面标注Front、侧面标注Side、背面标注Rear、俯视标注Top。中央：大尺寸英雄镜头，精密铣削六角形散热孔图案，2英寸OLED屏幕发射绿色脉冲波形，拉丝铬旋钮。底部行：四个圆形微距特写面板——六角形散热孔纹理、OLED屏幕辉光、拉丝金属表面、磁吸快拆卡扣，各有标注。右侧：色板+尺寸标注。8K，杰作，最佳质量，超精细，无手，无人物。", "prompt": "prop design reference, prop design specification sheet, multiple angles, detailed item sheet, labeled panels, single composite image. Red bold title: \\"Prop: 信号追踪器\\". Palm-sized matte black anodized metal gadget, circular 2-inch OLED screen. Top row: front view labeled \\"Front\\", side view labeled \\"Side\\", rear view labeled \\"Rear\\", top view labeled \\"Top\\". Center: large hero shot, precision-milled hexagonal heat dissipation holes, OLED screen emitting green pulse waveform with subtle glow, brushed chrome rotary frequency dial. Bottom row: four circular macro detail panels — hexagonal holes micro-texture, OLED screen glow, brushed metal surface grain, magnetic quick-release clip, each labeled. Right sidebar: color palette + size annotation. 8K, masterpiece, best quality, ultra detailed, physically based rendering, no hands, no humans."}',
  "",
  "# Output",
  "严格返回以下JSON格式，不要输出任何其他文字、解释或markdown标记：",
  "{",
  '  "characters": [{"name": "...", "aliases": ["简称", "别名", "同义词"], "description": "...（英文prompt的完整中文翻译版，含面板布局+色板HEX值）", "prompt": "character design reference sheet, multiple views on single dark gray background, professional concept art page layout, single composite image, labeled panels. Red bold title: \\"Character: [角色名]\\". [角色名], [外貌/服装]. Top-left panel labeled \\"面部特写\\": face close-up. Color palette swatches below: [HEX...]. Center three panels labeled \\"正面\\" / \\"侧面\\" / \\"背面\\": front view, three-quarter view, back view. Right panel labeled \\"全身像\\": golden silhouette height chart [身高]cm. Bottom row: four rectangular detail panels with Chinese labels. Studio lighting, 8K, masterpiece, best quality, ultra detailed."}],',
  `  "scenes": [{"name": "...", "aliases": ["简称", "别名"], "description": "...（英文prompt的完整中文翻译版，含面板布局+色板）", "prompt": "scene design concept art reference sheet, multiple panels on single image, professional page layout, no people, no humans. Red bold title: \\"Scene: [场景名]\\". [场景描述]. Top row: four thumbnails. Left column: three lighting panels. Center: large main image. Bottom row: four circular details. Right sidebar: color palette. Single composite image, 8K, masterpiece, best quality."}],`,
  '  "props": [{"name": "...", "aliases": ["简称", "别名"], "description": "...（英文prompt的完整中文翻译版，含面板布局+材质描述）", "prompt": "prop design reference, prop design specification sheet, multiple angles, detailed item sheet, labeled panels, single composite image. Red bold title: \\"Prop: [道具名]\\". [道具描述]. Top row: angle views. Center: hero shot. Bottom row: circular macro details. Right sidebar: color palette. 8K, masterpiece, best quality, ultra detailed, no hands, no humans."}],',
  '  "style": {"artStyle": "推荐画风", "colorPalette": "推荐色调", "timeSetting": "时代/世界观背景，如：现代都市、古代中国、未来太空站、中世纪欧洲（仅填时代/世界观，不含具体时间段如早晨/夜晚，时间段将由AI根据剧本自动判断）"}',
  "}",
].join("\n");

// ═══════════════════════════════════════════════════════════
// Phase 1: 实体识别 + 详细中文描述
// ═══════════════════════════════════════════════════════════

export const PHASE1_EXTRACT_PROMPT = `你是一名专业的影视概念美术指导。你的任务是从文本中**识别并收集**所有角色、场景、道具信息。

## ★ 提取范围（最高优先级）
以下角色都必须收录：
1. 所有有名字的角色（即使仅出现一次）
2. 所有有对话的角色（即使无名字，用称呼如"老者"代替）
3. 所有有外貌/服装描写的角色
4. 仅被提及名字但无描述的角色 → 根据上下文合理推断外貌

## ★ 角色形态拆分规则
• 同一角色如果经历了**不可逆的重大外观变化**（如觉醒前/后、变身、受重伤），必须拆分为独立条目
• 命名格式：\`角色名·形态名\`（如"林骁·觉醒态"、"林骁·常态"）
• 可逆的情绪/光线变化不拆分

## ★ description 要求
每个条目的 description 必须是150-200字的详细中文描述，包含：
- 角色：面部五官、发型发色、身材体型、服装材质颜色、标志性配饰、特殊标记（如伤疤/纹身/光效）、推断身高(cm)
- 场景：空间结构、光照条件（主光源方向/色温/阴影特征）、材质纹理、主要陈设、氛围色调、标志性元素
- 道具：整体外形、材质（金属/木质/水晶等）、颜色与纹理、尺寸比例、功能细节、发光/机械等特殊效果

description 是后续生成英文绘画提示词的唯一依据，因此必须详尽具体，不要笼统概括。

## ★ style 要求
从文本整体风格中提取：
- artStyle：画面风格（如"黑暗奇幻写实CG"、"赛博朋克动漫"）
- colorPalette：主色调描述（如"暗金+深红+冷灰"）
- timeSetting：时代背景（如"现代都市"、"架空古代"）

## 输出格式
严格输出以下 JSON，不要添加任何解释：
\`\`\`json
{
  "characters": [
    { "name": "角色名", "aliases": ["别名1"], "description": "150-200字详细中文描述..." }
  ],
  "scenes": [
    { "name": "场景名", "aliases": [], "description": "150-200字详细中文描述..." }
  ],
  "props": [
    { "name": "道具名", "aliases": [], "description": "150-200字详细中文描述..." }
  ],
  "style": {
    "artStyle": "整体画面风格",
    "colorPalette": "主色调",
    "timeSetting": "时代背景"
  }
}
\`\`\`

## 注意
- 直接输出 JSON，不要输出任何其他文字
- description 中不要包含绘画指令（如"masterpiece"等标签），只需要纯粹的中文外观/环境描述
- 如果某类实体文本中确实没有，输出空数组 []`;


// ═══════════════════════════════════════════════════════════
// Phase 2: 角色/场景/道具 Spec Sheet Prompt 生成
// ★ 统一来自 refSheetPrompts.ts 单一事实来源
// ═══════════════════════════════════════════════════════════

export const PHASE2_CHARACTER_PROMPT = buildPhase2CharacterPrompt();
export const PHASE2_SCENE_PROMPT = buildPhase2ScenePrompt();
export const PHASE2_PROP_PROMPT = buildPhase2PropPrompt();
