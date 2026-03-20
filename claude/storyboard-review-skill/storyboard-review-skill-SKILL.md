---
name: storyboard-review-skill
description: 分镜审核技能。用于审核分镜师产出的节拍拆解、九宫格提示词、四宫格提示词，以及动画师产出的动态提示词，确保符合方法论标准。
---

# 分镜审核技能

[技能说明]
    分镜审核技能，用于审核分镜师和动画师产出是否符合方法论标准。审核前必须先读取上游产物建立整体理解，再按 review-checklist.md 逐项检查。所有验收项必须通过才能判定为 PASS。

[文件结构]
    storyboard-review-skill/
    ├── SKILL.md                               # 本文件（技能包核心配置）
    ├── review-checklist.md                    # 验收清单（检查项列表）
    ├── storyboard-methodology-playbook.md     # 分镜方法论（分镜判定标准）
    └── motion-prompt-methodology.md           # 动态提示词方法论（Motion Prompt 判定标准）

[基准文档]
    分镜审核基准：
    - review-checklist.md
    - storyboard-methodology-playbook.md

    动态提示词审核基准：
    - review-checklist.md
    - motion-prompt-methodology.md

[功能]
    [审核节拍拆解]
        第一步：建立整体理解
            - 读取 script/（剧本原文）

        第二步：读取基准
            - 读取 review-checklist.md → 节拍拆解验收
            - 读取 storyboard-methodology-playbook.md

        第三步：读取待审核内容
            - 读取 outputs/beat-breakdown.md

        第四步：逐项检查
            - 按照 review-checklist.md 中的"节拍拆解验收"逐项检查

        第五步：输出结果
            - 全部通过 → PASS
            - 任一未通过 → FAIL + 问题清单

    [审核 Beat Board 九宫格提示词]
        第一步：建立整体理解
            - 读取 script/（剧本原文）
            - 读取 outputs/beat-breakdown.md（节拍拆解）

        第二步：读取基准
            - 读取 review-checklist.md → Beat Board 验收
            - 读取 storyboard-methodology-playbook.md

        第三步：读取待审核内容
            - 读取 outputs/beat-board-prompt.md

        第四步：逐项检查
            - 按照 review-checklist.md 中的"Beat Board 验收"逐项检查

        第五步：输出结果
            - 全部通过 → PASS
            - 任一未通过 → FAIL + 问题清单

    [审核 Sequence Board 四宫格提示词]
        第一步：建立整体理解
            - 读取 script/（剧本原文）
            - 读取 outputs/beat-breakdown.md（节拍拆解）
            - 读取 outputs/beat-board-prompt.md（九宫格提示词）

        第二步：读取基准
            - 读取 review-checklist.md → Sequence Board 验收
            - 读取 storyboard-methodology-playbook.md

        第三步：读取待审核内容
            - 读取 outputs/sequence-board-prompt.md

        第四步：逐项检查
            - 按照 review-checklist.md 中的"Sequence Board 验收"逐项检查
            - 重点检查与九宫格的一致性继承

        第五步：输出结果
            - 全部通过 → PASS
            - 任一未通过 → FAIL + 问题清单

    [审核 Motion Prompt 动态提示词]
        第一步：建立整体理解
            - 读取 script/（剧本原文）
            - 读取 outputs/beat-breakdown.md（节拍拆解）
            - 读取 outputs/beat-board-prompt.md（九宫格提示词）
            - 读取 outputs/sequence-board-prompt.md（四宫格提示词）

        第二步：读取基准
            - 读取 review-checklist.md → Motion Prompt 验收
            - 读取 motion-prompt-methodology.md

        第三步：读取待审核内容
            - 读取 outputs/motion-prompt.md

        第四步：逐项检查
            - 按照 review-checklist.md 中的"Motion Prompt 验收"逐项检查
            - 重点检查动作是否与分镜匹配

        第五步：输出结果
            - 全部通过 → PASS
            - 任一未通过 → FAIL + 问题清单

    [整体交付审核]
        第一步：建立整体理解
            - 读取 script/（剧本原文）
            - 读取 outputs/beat-breakdown.md（节拍拆解）
            - 读取 outputs/beat-board-prompt.md（九宫格提示词）
            - 读取 outputs/sequence-board-prompt.md（四宫格提示词）
            - 读取 outputs/motion-prompt.md（动态提示词）

        第二步：读取基准
            - 读取 review-checklist.md → 最终交付验收
            - 读取 storyboard-methodology-playbook.md → [规则库]
            - 读取 motion-prompt-methodology.md → [验收清单]

        第三步：逐项检查
            - 按照 review-checklist.md 中的"最终交付验收"逐项检查

        第四步：输出结果
            - 全部通过 → PASS
            - 任一未通过 → FAIL + 问题清单

[输出规范]
    [PASS 格式]
        ✅ **审核状态：PASS**

        [阶段名称] 已通过全部验收项。

        **可以进入下一阶段。**

    [FAIL 格式]
        ❌ **审核状态：FAIL**

        [阶段名称] 发现以下问题：

        **问题1**：[具体问题描述]
        - 位置：[具体位置，如：格3、Beat #5、Motion Prompt 2-3]
        - 违反验收项：[哪条验收项未通过]
        - 修改方向：[具体建议]

        **问题2**：[如有]
        - ...

        ---

        **修改优先级**：
        1. 🔴 必须修改：[列出]
        2. 🟡 建议修改：[列出]

        请修改后重新提交审核。

[注意事项]
    - 审核前必须先读取上游产物，建立整体理解
    - 审核分镜内容时使用 storyboard-methodology-playbook.md 作为判定依据
    - 审核动态提示词时使用 motion-prompt-methodology.md 作为判定依据
    - 审核必须基于 review-checklist.md，不能随意增减标准
    - 问题描述必须具体到位置，不能泛泛而谈
    - 只有全部验收项通过才能输出 PASS
