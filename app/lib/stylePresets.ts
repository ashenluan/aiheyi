import { kvLoad, kvSet } from "./kvDB";

export type StylePresetSource = "builtin" | "custom";

export interface StylePreset {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  previewImage: string;
  source: StylePresetSource;
}

export interface StyleDatabaseOption {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  description: string;
}

const CUSTOM_STYLE_PRESETS_KEY = "feicai-style-presets";

const BUILTIN_STYLE_PRESET_DEFS = [
  { id: "3d-xianxia", label: "3D国漫仙侠", emoji: "🐉", prompt: "风格：3D国漫，CG渲染，玄幻仙侠炫彩风，鎏金、绯红、冰蓝、紫霞为主色调，仙山云海、浮空神殿、秘境结界场景，特效以法术光效（龙气、雷劫、仙光、结界）为主，角色技能带拖尾、光爆、粒子消散，画面华丽又有东方仙气" },
  { id: "cyberpunk", label: "赛博朋克", emoji: "🌃", prompt: "风格：赛博朋克，霓虹光影，暗黑科幻，以电光蓝、品红、毒绿、铬银为主色调，高楼林立的雨夜街道、全息广告牌、地下黑市、飞行器穿梭的天际线场景，特效以全息投影、数据流粒子、电弧闪烁、霓虹倒影为主，角色装备带LED光线、机械义体荧光、HUD界面叠加，画面潮湿阴暗又充满科技感" },
  { id: "anime-cel", label: "日系赛璐璐", emoji: "🌸", prompt: "风格：日系赛璐璐，手绘动画感，京アニ级精细作画，以柔光暖橘、樱粉、天空蓝、月光银为主色调，日式校园、夕阳河堤、夜樱古街、海边灯塔场景，特效以光晕散射、花瓣飘落、水面波光、发丝透光为主，角色表情细腻带微妙情绪变化，画面清新治愈又有电影质感" },
  { id: "dark-gothic", label: "暗黑哥特", emoji: "🦇", prompt: "风格：暗黑奇幻，哥特美学，魂系列风格油画质感，以深渊黑、血红、锈铜、幽灵绿为主色调，荒废大教堂、枯萎巨树、地下墓穴、熔岩裂谷场景，特效以迷雾弥漫、灵魂火焰、腐蚀光晕、血雾爆裂为主，角色装备带暗金锈蚀纹理、骨甲、咒文刻痕，画面压抑沉重又有史诗宏大感" },
  { id: "ghibli", label: "吉卜力田园", emoji: "🍃", prompt: "风格：吉卜力风格，水彩手绘，自然田园，以草绿、麦金、天蓝、云白为主色调，丘陵草原、蒸汽小镇、森林深处的小木屋、云上浮岛场景，特效以微风拂动、萤火虫光点、炊烟袅袅、阳光穿透树冠为主，角色动作带日常生活气息，画面温暖质朴又有魔法世界的奇妙感" },
  { id: "marvel-dc", label: "美漫超英", emoji: "⚡", prompt: "风格：美漫超英，漫威/DC电影级CG渲染，肌肉感强烈的英雄体型，以钢铁灰、正义蓝、烈焰红、雷霆金为主色调，都市废墟战场、太空站、高科技基地、异次元裂缝场景，特效以能量光束、冲击波扩散、碎片慢动作飞散、闪电环绕为主，角色姿态带力量感和速度线，画面热血燃爆又有大片质感" },
  { id: "pixel-retro", label: "像素复古", emoji: "👾", prompt: "风格：像素艺术，16bit复古游戏风，精致点阵画，以高饱和红、宝石蓝、嫩绿、亮黄为主色调，像素城堡、地牢迷宫、魔法森林、星空宇宙场景，特效以8bit闪烁光效、像素粒子爆炸、屏幕震动、逐帧动画残影为主，角色动作夸张带Q版比例，画面怀旧可爱又有精致工艺感" },
  { id: "ink-wash", label: "墨韵国风", emoji: "🎨", prompt: "风格：中国水墨，传统工笔与泼墨结合，留白意境，以墨黑、宣白、朱砂红、石青蓝为主色调，云山飞瀑、古刹松林、江南小桥、大漠孤烟场景，特效以墨迹晕染扩散、水纹流动、烟雾飘渺、朱印落款为主，角色衣袂翻飞带书法线条感，画面空灵写意又有东方哲学气韵" },
  { id: "steampunk", label: "蒸汽朋克", emoji: "⚙️", prompt: "风格：蒸汽朋克，维多利亚工业美学，黄铜与蒸汽，以古铜金、铁锈橙、深棕、蒸汽白为主色调，齿轮钟楼、飞艇船坞、蒸汽工厂、地下矿洞场景，特效以蒸汽喷射、齿轮联动转动、火花飞溅、气压表指针摇摆为主，角色装备带铆钉皮革、单片眼镜、机械臂，画面复古厚重又有工业浪漫感" },
  { id: "disney-3d", label: "迪士尼3D", emoji: "✨", prompt: "风格：迪士尼/皮克斯3D动画，卡通渲染，高饱和明亮色彩，以糖果粉、天空蓝、阳光黄、薄荷绿为主色调，童话城堡、糖果小镇、海底王国、魔法学院场景，特效以星光闪烁、彩虹光带、魔法粉尘飘散、泡泡折射为主，角色表情夸张生动带大眼睛圆润造型，画面欢快明亮又有梦幻童话感" },
  { id: "ukiyoe", label: "浮世绘和风", emoji: "🌊", prompt: "风格：浮世绘，日本传统版画，平面构图与粗线条，以靛蓝、朱红、藤黄、素白为主色调，巨浪怒涛、富士雪山、花街柳巷、武士阵前场景，特效以浪花飞溅线条化、樱吹雪铺满画面、云纹卷曲装饰、金箔点缀为主，角色姿态带歌舞伎夸张造型与浮世绘特有的侧脸透视，画面古朴典雅又有戏剧张力" },
  { id: "oil-painting", label: "古典油画", emoji: "🖼️", prompt: "风格：古典油画，文艺复兴大师笔触，丰富的明暗对比与肌理质感，以深棕、暗金、猩红、象牙白为主色调，宫廷大厅、教堂穹顶、田园牧场、海港落日场景，特效以烛光摇曳的伦勃朗光影、油彩笔触纹理、光线穿透云层的丁达尔效应为主，角色姿态带古典雕塑感与戏剧性布光，画面厚重写实又有艺术殿堂级美感" },
  { id: "cyberpunk-anime", label: "赛博日漫", emoji: "🤖", prompt: "风格：赛博朋克×日系动画，攻壳机动队/Akira风格，以深紫、电光蓝、荧光橙、暗银为主色调，未来东京废墟、霓虹地下城、机械实验室、数据空间场景，特效以故障艺术画面撕裂、数据矩阵飞流、义体荧光回路、全息UI界面为主，角色带机械改装与赛璐璐上色的混搭风，画面硬核科幻又有日式细腻美学" },
  { id: "wuxia-realistic", label: "写实武侠", emoji: "⚔️", prompt: "风格：写实武侠，电影级CG渲染，张艺谋/徐克武侠片质感，以墨青、枫红、烟灰、月白为主色调，竹海剑庐、客栈雨巷、悬崖瀑布、大漠长河场景，特效以剑气斩破雨幕、轻功踏叶飞掠、内力气旋翻涌、血溅黄沙为主，角色动作凌厉舒展带武术真实感，画面大气磅礴又有江湖意境" },
  { id: "vintage-film", label: "复古胶片", emoji: "📽️", prompt: "风格：复古胶片电影，柯达/富士胶卷色调，颗粒感与光晕，以暖黄、褪色青、焦糖棕、奶油白为主色调，70年代街头、老式咖啡馆、夏日公路、黄昏海岸场景，特效以胶片噪点颗粒、镜头光晕眩光、轻微过曝泛白、色彩偏移漂移为主，角色状态自然随性带生活纪实感，画面温柔怀旧又有文艺电影质感" },
  { id: "horror-thriller", label: "惊悚恐怖", emoji: "👻", prompt: "风格：恐怖惊悚，电影级暗调摄影，不安的构图与压迫感，以漆黑、惨白、腐绿、暗红为主色调，废弃医院、雾锁森林、地下通道、破败洋楼场景，特效以闪烁灯管频闪、暗角渐晕、影子扭曲蠕动、雾气弥漫遮蔽视线为主，角色表情带恐惧与不安的微表情捕捉，画面窒息压抑又有心理惊悚的悬念感" },
  { id: "sci-fi-epic", label: "史诗科幻", emoji: "🚀", prompt: "风格：史诗科幻，星际大片级CG渲染，宏大宇宙尺度，以星空黑、等离子蓝、引擎橙、钛合金银为主色调，太空战舰舰桥、外星荒原、星门虫洞、轨道空间站场景，特效以等离子引擎尾焰、激光束交叉、太空碎片漂浮、行星环光带为主，角色穿着精密宇航服或外骨骼装甲，画面宏大壮阔又有硬科幻的真实质感" },
  { id: "dreamy-pastel", label: "梦幻柔彩", emoji: "🦄", prompt: "风格：梦幻柔彩，柔焦朦胧感，少女心插画风，以薰衣草紫、蜜桃粉、奶油黄、薄荷蓝为主色调，云端花园、水晶宫殿、星空湖畔、月光森林场景，特效以柔光弥漫、星尘缓缓飘落、花瓣旋转上升、水彩晕染扩散为主，角色造型精致带蝴蝶结与蕾丝细节，画面温柔梦幻又有治愈系的浪漫氛围" },
  { id: "korean-webtoon", label: "韩漫唯美", emoji: "🎎", prompt: "风格：韩漫唯美，精致半写实插画风，柔光磨皮与细腻上色，以玫瑰粉、月光蓝、香槟金、云雾灰为主色调，首尔江南豪宅、樱花大道、天台夜景、落地窗咖啡厅场景，特效以柔焦背景虚化、逆光发丝透亮、眼眸星光反射、花瓣慢速飘落为主，角色五官精致带高光阴影层次感，画面唯美浪漫又有韩剧电影级氛围" },
  { id: "nolan-epic", label: "诺兰大片", emoji: "🎬", prompt: "风格：诺兰大片，IMAX胶片级摄影，冷峻写实与宏大叙事，以钢蓝、混凝土灰、深海墨、冰川白为主色调，旋转走廊、沙漠堡垒、冰原基地、时间扭曲空间场景，特效以实拍质感爆破、低频震动感、时间膨胀慢动作、大面积实景坍塌为主，角色表情克制内敛带心理博弈张力，画面冷峻严肃又有烧脑悬疑的史诗厚重感" },
  { id: "post-apocalypse", label: "末日废土", emoji: "🏜️", prompt: "风格：末日废土，疯狂麦克斯式荒漠美学，粗粝颗粒感，以沙尘黄、铁锈红、焦黑、褪色卡其为主色调，沙暴吞噬的废弃公路、改装战车营地、骸骨点缀的荒原、坍塌的摩天大楼场景，特效以沙尘暴翻涌、火焰尾迹、金属碎片飞溅、引擎排气热浪为主，角色装备带金属护甲拼接与布条缠绕的末世改装感，画面苍凉狂野又有绝望中的生存力量" },
  { id: "zombie-apocalypse", label: "丧尸末世", emoji: "🧟", prompt: "风格：丧尸末世，行尸走肉级写实恐怖，压抑的荒凉感，以腐败绿、凝血红、阴霾灰、枯骨白为主色调，荒废城市街道、废弃超市、布满藤蔓的医院、焚烧过的避难所场景，特效以血雾喷溅、玻璃碎裂、远处火光映天、手电筒光柱穿透黑暗为主，角色带伤痕疲惫的求生者造型与丧尸腐化妆效，画面紧张绝望又有末世求生的残酷真实感" },
  { id: "urban-realistic", label: "都市写实", emoji: "🏙️", prompt: "风格：都市写实，现代城市摄影级画质，自然光与人工光交织，以霓虹紫、路灯暖黄、天幕深蓝、柏油灰为主色调，地铁车厢、雨天十字路口、深夜便利店、玻璃幕墙写字楼场景，特效以雨滴打在车窗模糊光斑、手机屏幕映照面部、车流拉丝长曝光、蒸汽从下水道升腾为主，角色穿着当代都市服饰带生活化自然姿态，画面真实细腻又有都市孤独与烟火气并存的电影感" },
] as const;

export const BUILTIN_STYLE_PRESETS: StylePreset[] = BUILTIN_STYLE_PRESET_DEFS.map((preset) => ({
  ...preset,
  previewImage: `/style-previews/${preset.id}.png`,
  source: "builtin",
}));

export const VISUAL_STYLE_OPTIONS: StyleDatabaseOption[] = [
  { id: "cinematic-realism", label: "电影写实", emoji: "🎬", prompt: "cinematic realism, premium production design, grounded details, natural skin texture, believable materials, story-driven composition", description: "适合主流剧情片、现实向角色与高完成度叙事镜头" },
  { id: "oriental-xianxia", label: "东方仙侠", emoji: "🐉", prompt: "oriental xianxia fantasy, celestial atmosphere, ornate costume design, floating mist, elegant magical energy, majestic Chinese fantasy worldbuilding", description: "更偏国风幻想、仙侠修真和华丽法术感" },
  { id: "asian-aesthetic", label: "亚洲美学", emoji: "🌸", prompt: "refined asian aesthetics, delicate facial structure, polished styling, graceful silhouettes, premium beauty photography, elegant contemporary visuals", description: "突出五官精致、服化统一和高级人像质感" },
  { id: "anime-cinema", label: "动画电影感", emoji: "🎞️", prompt: "animated cinematic look, expressive design, crisp silhouettes, rich color styling, emotionally readable staging, filmic anime lighting", description: "适合日漫、韩漫、动画电影式画面" },
  { id: "dark-fantasy", label: "暗黑奇幻", emoji: "🦇", prompt: "dark fantasy epic, gothic atmosphere, textured ruins, moody contrast, dramatic weathering, mythic scale", description: "更适合史诗黑暗、哥特、怪物与压迫感世界观" },
  { id: "cyber-future", label: "赛博未来", emoji: "🌃", prompt: "cyber future, neon density, high-tech surfaces, holographic glow, sleek urban futurism, layered sci-fi depth", description: "适合都市未来、霓虹夜景和科技题材" },
  { id: "ink-eastern", label: "写意国风", emoji: "🎨", prompt: "eastern ink elegance, poetic negative space, calligraphic flow, restrained palette, painterly rhythm, Chinese classical mood", description: "适合水墨、工笔、东方叙事和意境表达" },
  { id: "epic-sci-fi", label: "史诗科幻", emoji: "🚀", prompt: "epic science fiction, large-scale environments, engineered detail, cosmic grandeur, cinematic machinery, premium VFX spectacle", description: "适合太空、机甲、星际战场与硬核科幻" },
];

export const QUALITY_PRESET_OPTIONS: StyleDatabaseOption[] = [
  { id: "standard-story", label: "标准叙事", emoji: "🧩", prompt: "clean storytelling image, balanced detail, stable composition, reliable readability, efficient generation", description: "优先保证稳定出图和信息表达" },
  { id: "cinema-finish", label: "电影精修", emoji: "🎥", prompt: "premium cinematic finish, refined texture control, polished rendering, controlled contrast, premium production-grade details", description: "更强调电影级细节与完成度" },
  { id: "poster-master", label: "海报终稿", emoji: "🖼️", prompt: "hero poster quality, highly polished surfaces, striking focal contrast, luxury-grade finishing, showcase-ready detail density", description: "适合关键视觉、封面和主宣海报" },
];

export const LENS_EFFECT_OPTIONS: StyleDatabaseOption[] = [
  { id: "epic-wide", label: "广角史诗", emoji: "🌄", prompt: "epic wide-angle lens, strong spatial depth, dramatic foreground-background separation", description: "拉开空间层次，适合大场面与环境叙事" },
  { id: "tele-compress", label: "长焦压缩", emoji: "🔭", prompt: "telephoto compression, layered depth compression, elegant subject isolation", description: "适合人像、群像和都市压缩透视" },
  { id: "handheld-docu", label: "手持纪实", emoji: "🎥", prompt: "handheld documentary energy, organic framing, subtle motion tension, lived-in realism", description: "强化现场感和即时性" },
  { id: "dream-soft", label: "柔焦梦境", emoji: "☁️", prompt: "soft focus dream haze, gentle bloom, silky highlights, romantic diffusion", description: "适合爱情、回忆、幻梦和唯美段落" },
  { id: "macro-closeup", label: "微距特写", emoji: "🔍", prompt: "macro close-up emphasis, tactile detail rendering, intimate focal attention", description: "放大细节、材质和微表情" },
  { id: "tracking-motion", label: "运动跟拍", emoji: "🏃", prompt: "dynamic tracking shot feel, directional motion energy, cinematic pursuit rhythm", description: "适合动作、追逐和连续运动镜头" },
  { id: "dutch-tilt", label: "倾斜失衡", emoji: "🌀", prompt: "dutch tilt tension, psychological imbalance, stylized dramatic framing", description: "适合悬疑、危机和失序氛围" },
  { id: "anamorphic-flare", label: "宽银幕炫光", emoji: "✨", prompt: "anamorphic lens character, cinematic horizontal flares, premium wide-screen optics", description: "强调大片镜头感和银幕质感" },
];

export const LIGHTING_MOOD_OPTIONS: StyleDatabaseOption[] = [
  { id: "golden-hour", label: "鎏金日落", emoji: "🌇", prompt: "golden hour sunlight, amber rim light, warm atmospheric glow, emotional sunset contrast", description: "适合温暖、浪漫和回忆感场景" },
  { id: "moonlit-blue", label: "冷月夜景", emoji: "🌙", prompt: "moonlit blue night, cool contrast, nocturnal hush, crisp silver-blue highlights", description: "适合夜戏、孤独和克制情绪" },
  { id: "neon-rain", label: "霓虹夜雨", emoji: "🌧️", prompt: "neon rain reflections, wet surfaces, urban glow, moody cyber night atmosphere", description: "赛博、都市、夜雨和霓虹反射" },
  { id: "studio-hardlight", label: "棚拍硬光", emoji: "💡", prompt: "hard studio key light, sharp specular contrast, premium editorial lighting", description: "适合角色定妆、海报和商业质感" },
  { id: "candle-drama", label: "烛火戏剧", emoji: "🕯️", prompt: "candlelit drama, low-key warm highlights, intimate shadows, period atmosphere", description: "适合宫廷、古装、密室与情绪戏" },
  { id: "backlit-silhouette", label: "逆光边缘", emoji: "🌤️", prompt: "backlit silhouette edges, glowing rim light, heroic contour separation", description: "适合英雄时刻、情绪高潮和轮廓表现" },
  { id: "overcast-diffuse", label: "阴天漫射", emoji: "☁️", prompt: "overcast diffuse lighting, soft even skin tones, subdued contrast, calm realism", description: "适合日常戏、写实戏和柔和皮肤表现" },
  { id: "stage-spotlight", label: "舞台聚光", emoji: "🎭", prompt: "stage spotlight focus, dramatic isolation, theatrical beams, centered dramatic emphasis", description: "适合舞台感、仪式感和高反差聚焦" },
];

function findOptionById(options: StyleDatabaseOption[], id?: string | null): StyleDatabaseOption | undefined {
  if (!id) return undefined;
  return options.find((option) => option.id === id);
}

export function getVisualStyleById(id?: string | null): StyleDatabaseOption | undefined {
  return findOptionById(VISUAL_STYLE_OPTIONS, id);
}

export function getQualityPresetById(id?: string | null): StyleDatabaseOption | undefined {
  return findOptionById(QUALITY_PRESET_OPTIONS, id);
}

export function getLightingMoodById(id?: string | null): StyleDatabaseOption | undefined {
  return findOptionById(LIGHTING_MOOD_OPTIONS, id);
}

export function getLensEffectById(id?: string | null): StyleDatabaseOption | undefined {
  return findOptionById(LENS_EFFECT_OPTIONS, id);
}

export function normalizeLensEffectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(LENS_EFFECT_OPTIONS.map((option) => option.id));
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (!valid.has(item) || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

export function buildStyleDatabasePromptParts(input: {
  visualStyle?: string | null;
  qualityPreset?: string | null;
  lensEffects?: string[] | null;
  lightingMood?: string | null;
}): string[] {
  const parts: string[] = [];
  const visual = getVisualStyleById(input.visualStyle);
  const quality = getQualityPresetById(input.qualityPreset);
  const lighting = getLightingMoodById(input.lightingMood);
  const lens = normalizeLensEffectIds(input.lensEffects).map((id) => getLensEffectById(id)).filter(Boolean) as StyleDatabaseOption[];
  if (visual) parts.push(`整体风格：${visual.label}；要求：${visual.prompt}`);
  if (quality) parts.push(`画质档位：${quality.label}；要求：${quality.prompt}`);
  if (lens.length > 0) parts.push(`镜头效果：${lens.map((item) => item.label).join("、")}；要求：${lens.map((item) => item.prompt).join("; ")}`);
  if (lighting) parts.push(`光影预设：${lighting.label}；要求：${lighting.prompt}`);
  return parts;
}

export function buildStyleDatabaseSummary(input: {
  visualStyle?: string | null;
  qualityPreset?: string | null;
  lensEffects?: string[] | null;
  lightingMood?: string | null;
}): string {
  const summary: string[] = [];
  const visual = getVisualStyleById(input.visualStyle);
  const quality = getQualityPresetById(input.qualityPreset);
  const lighting = getLightingMoodById(input.lightingMood);
  const lens = normalizeLensEffectIds(input.lensEffects).map((id) => getLensEffectById(id)).filter(Boolean) as StyleDatabaseOption[];
  if (visual) summary.push(visual.label);
  if (quality) summary.push(quality.label);
  if (lens.length > 0) summary.push(lens.map((item) => item.label).join(" / "));
  if (lighting) summary.push(lighting.label);
  return summary.join(" · ");
}

function normalizeCustomPreset(value: unknown): StylePreset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const emoji = typeof raw.emoji === "string" ? raw.emoji.trim() : "✨";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const previewImage = typeof raw.previewImage === "string" ? raw.previewImage : "";
  if (!id || !label || !prompt || !previewImage) return null;
  return { id, label, emoji: emoji || "✨", prompt, previewImage, source: "custom" };
}

export function createCustomStylePresetId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getStylePresetById(id?: string | null, customPresets: StylePreset[] = []): StylePreset | undefined {
  if (!id) return undefined;
  return BUILTIN_STYLE_PRESETS.find((preset) => preset.id === id) || customPresets.find((preset) => preset.id === id);
}

export async function loadCustomStylePresetsAsync(): Promise<StylePreset[]> {
  if (typeof window === "undefined") return [];
  try {
    const saved = await kvLoad(CUSTOM_STYLE_PRESETS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.map(normalizeCustomPreset).filter(Boolean) as StylePreset[];
    }
  } catch {
    /* ignore */
  }
  try {
    const fallback = localStorage.getItem(CUSTOM_STYLE_PRESETS_KEY);
    if (!fallback) return [];
    const parsed = JSON.parse(fallback);
    if (Array.isArray(parsed)) return parsed.map(normalizeCustomPreset).filter(Boolean) as StylePreset[];
  } catch {
    /* ignore */
  }
  return [];
}

export async function saveCustomStylePresets(presets: StylePreset[]): Promise<void> {
  const payload = JSON.stringify(
    presets
      .filter((preset) => preset.source === "custom")
      .map(({ id, label, emoji, prompt, previewImage }) => ({ id, label, emoji, prompt, previewImage })),
  );
  if (typeof window !== "undefined") {
    try { localStorage.setItem(CUSTOM_STYLE_PRESETS_KEY, payload); } catch { /* ignore */ }
  }
  await kvSet(CUSTOM_STYLE_PRESETS_KEY, payload);
}
