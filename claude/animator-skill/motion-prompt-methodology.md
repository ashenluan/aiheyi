---
name: motion-prompt-methodology
description: 图生视频动态提示词方法论。用于将静态分镜转化为 AI 视频工具（Runway、Kling、Pika 等）的动态提示词。包含镜头运动、主体动作、速度修饰、氛围风格的词汇库与转化规则。
---

# 图生视频动态提示词方法论（Motion Prompt Methodology）

[第一性原则]
    图片已见原则
        - AI 能"看到"输入图片，不需要重复描述图片内容
        - 只描述"变化"：动作、运动、情绪转变
        - 重复描述图片内容会导致运动减少或异常

    简洁优先原则
        - 最佳长度：50-200 字符（英文）
        - 聚焦 2-3 个核心元素
        - 信息过载会导致模型困惑

    具体动作原则
        - 用具体的物理动作，避免抽象概念
        - "hair flowing in wind" ✓
        - "embodies the essence of freedom" ✗

    运动限制原则
        - 镜头运动：最多 1-2 种
        - 主体运动：最多 1-2 种
        - 过多运动会产生混乱

[提示词结构]
    基本公式
        镜头运动 + 主体动作 + 速度/节奏 + 氛围/风格

    完整公式（复杂场景）
        镜头运动 + 主体动作 + 环境动态 + 速度/节奏 + 氛围/风格 + 技术参数

    示例
        基本：Camera slowly pushes in while subject turns head
        完整：Slow dolly in, subject turns head, hair flowing gently in wind, golden hour lighting, cinematic 24fps

[镜头运动词汇库]
    推拉类（Dolly）
        - dolly in / push in：推近，聚焦、紧张、亲密
        - dolly out / pull back：拉远，揭示、疏离、结束感
        - dolly zoom / vertigo effect：眩晕效果，心理冲击

    横纵摇类（Pan/Tilt）
        - pan left / pan right：横摇，环顾、跟随水平运动
        - tilt up / tilt down：纵摇，强调高度、规模、威严
        - whip pan：快速横摇，转场、惊讶

    环绕类（Orbit/Arc）
        - orbit around subject：环绕主体，立体感、动感
        - arc shot：弧形运动，戏剧性、强调
        - 180-degree orbit：半环绕，常用于对话、对峙
        - 360-degree orbit：全环绕，产品展示、英雄时刻

    跟拍类（Tracking）
        - tracking shot：跟随主体移动
        - follow from behind：背后跟拍
        - side tracking：侧面跟拍
        - leading shot：前方引导

    变焦类（Zoom）
        - zoom in：变焦推近，强调、戏剧性
        - zoom out：变焦拉远，揭示全貌
        - slow zoom：缓慢变焦，悬疑、张力

    升降类（Crane/Jib）
        - crane up / rising shot：上升，史诗感、希望
        - crane down / descending shot：下降，压迫、沉重
        - aerial / drone shot：航拍，规模、全景

    手持与稳定（Handheld/Stabilized）
        - handheld：手持，真实感、紧张、纪录片风格
        - steady / locked camera：固定机位，稳定、庄重
        - floating camera：漂浮感，梦幻、超现实

    焦点类（Focus）
        - rack focus：焦点转移，引导注意力
        - shallow depth of field：浅景深，突出主体
        - deep focus：深焦，环境信息丰富

[主体动作词汇库]
    面部动作
        - eyes open slowly：缓慢睁眼
        - subtle smile forming：微笑浮现
        - gaze shifts：目光转移
        - eyebrows raise：眉毛上扬
        - blinks naturally：自然眨眼
        - expression transitions from X to Y：表情从X转为Y

    头部动作
        - head turns：转头
        - head tilts slightly：微微歪头
        - nods slowly：缓慢点头
        - looks up / down / away：抬头/低头/移开视线

    身体动作
        - breathing motion：呼吸起伏
        - shoulders rise and fall：肩膀起伏
        - leans forward / back：前倾/后仰
        - stands up / sits down：站起/坐下
        - walks forward / toward camera：向前走/走向镜头
        - reaches out hand：伸出手

    手部动作
        - hand raises：举手
        - fingers move：手指动作
        - grips tighter：握紧
        - gestures while speaking：说话时比划

    环境互动
        - hair flowing in wind：头发随风飘动
        - clothes rustling：衣服飘动
        - fabric billowing：布料鼓起
        - water splashing：水花飞溅
        - leaves falling：落叶飘落
        - smoke rising：烟雾升起
        - dust particles floating：尘埃飘浮

[速度与强度修饰词]
    缓慢/轻柔
        - slowly, gently, gradually, softly
        - subtle, slight, delicate
        - natural, organic, barely perceptible
        - micro-movements, minimal motion

    中等/自然
        - smoothly, steadily, naturally
        - moderate, balanced, controlled
        - fluid, flowing, continuous

    快速/强烈
        - quickly, rapidly, suddenly
        - dramatic, bold, powerful, intense
        - explosive, dynamic, energetic
        - sweeping, grand, epic

[氛围与风格词汇]
    电影风格
        - cinematic, filmic, movie-quality
        - blockbuster style, Hollywood quality
        - indie film aesthetic
        - documentary style

    导演风格（参考）
        - Christopher Nolan cinematography：史诗、庄重
        - David Fincher style：悬疑、精准
        - Terrence Malick aesthetic：诗意、自然光
        - Wes Anderson style：对称、色彩饱和

    情绪氛围
        - dramatic, intense, suspenseful
        - romantic, dreamy, nostalgic
        - mysterious, eerie, haunting
        - joyful, energetic, uplifting
        - melancholic, somber, contemplative

    技术参数（可选）
        - 24fps：电影感
        - 60fps：流畅、慢动作素材
        - slow motion：慢动作
        - film grain：胶片颗粒感
        - lens flare：镜头光晕
        - bokeh：背景虚化光斑

[禁忌规则]
    绝对禁忌
        - ❌ 否定句（No movement, Don't zoom）
            → AI 不理解否定，可能产生相反效果
            → ✓ 用肯定句：The camera stays still / locked camera

        - ❌ 重复图片内容
            → 会导致运动减少或静止
            → ✓ 只描述动作变化

        - ❌ 抽象概念（embodies freedom, manifests joy）
            → AI 无法解释抽象意图
            → ✓ 用具体物理动作

        - ❌ 多重场景变化
            → 模型无法处理复杂转场
            → ✓ 单一场景、单一动作链

    避免事项
        - ⚠️ 超过 2 种镜头运动组合
        - ⚠️ 超过 2 种主体运动组合
        - ⚠️ 过长提示词（超过 300 字符）
        - ⚠️ 违反物理规律的动作
        - ⚠️ 与图片内容矛盾的描述

[提示词模板]
    人物肖像动态化
        [镜头运动], [面部动作], [环境动态], [氛围]
        示例：Slow dolly in, eyes open slowly, hair flowing gently in wind, cinematic lighting

    产品展示
        [环绕运动], [光影变化], [材质强调], [风格]
        示例：360-degree orbit around product, reflections dancing on surface, premium feel, Apple commercial style

    动作场景
        [跟拍运动], [主体动作], [环境反应], [节奏]
        示例：Tracking shot following subject, walking forward confidently, dust particles flying, high energy

    情绪转变
        [镜头运动], [表情变化], [光影配合], [风格参考]
        示例：Slow zoom in, expression transitions from neutral to smile, warm lighting enhancement, intimate portrait feel

    环境氛围
        [镜头运动], [环境动态], [氛围元素], [风格]
        示例：Slow pan across landscape, clouds drifting, golden hour lighting, epic cinematic scale

[从分镜到动态提示词的转化]
    输入
        - Beat Board 九宫格提示词（关键帧）
        - Sequence Board 四宫格提示词（段落展开）

    输出
        - 每个 Beat Anchor 一组 Motion Prompt
        - 每组 5 个：1 关键帧 + 4 四宫格
        - 共 9 组 45 个

    转化步骤
        1. 识别画面核心动作
            - 从分镜的"视角"描述中提取关键动作
            - 确定主体运动和镜头运动

        2. 简化为核心元素
            - 删除外观描述（AI已从图片获取）
            - 保留动作、运动、氛围
            - 控制在 2-3 个核心元素

        3. 选择镜头运动
            - 根据情绪选择镜头运动类型
            - 紧张/聚焦 → push in
            - 揭示/疏离 → pull back
            - 动感/立体 → orbit
            - 跟随/沉浸 → tracking

        4. 添加速度修饰
            - 根据情绪节奏选择速度词
            - 平静 → slowly, gently
            - 紧张 → quickly, suddenly
            - 戏剧 → dramatically

        5. 补充氛围（可选）
            - 添加风格参考或技术参数
            - 保持简洁，不超过 1-2 个

    转化示例
        四宫格描述：
        "中景，教室内，林书白站在窗边，阳光斜射进来，他缓缓转头看向门口"

        Motion Prompt：
        "Slow pan, subject turns head toward door, sunlight streaming through window, cinematic"
