import Link from "next/link";
import Sidebar from "../../components/Sidebar";
import { comfyUiExampleWorkflow } from "@/app/lib/comfyui/sampleWorkflow";
import { ArrowLeft, Cpu, ExternalLink, SquareTerminal, Workflow } from "lucide-react";

const exampleJson = JSON.stringify(comfyUiExampleWorkflow, null, 2);

export default function ComfyUiGuidePage() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 overflow-auto px-10 py-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="flex items-center gap-4">
            <Link
              href="/comfyui"
              className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              <ArrowLeft size={16} />
              返回 ComfyUI 工作流
            </Link>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-[var(--text-secondary)]">接入文档</span>
            <h1 className="font-serif text-[36px] text-[var(--text-primary)]">ComfyUI 接入指南</h1>
            <p className="max-w-[900px] text-[14px] leading-relaxed text-[var(--text-secondary)]">
              这页用于说明如何把本地或远程的 ComfyUI 节点接进 FEICAI 工作流。只要能访问 ComfyUI 的 HTTP API，
              就可以用 `/comfyui` 页面做状态检查和工作流投递。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              {
                icon: Cpu,
                title: "推荐启动参数",
                text: "本机测试建议使用 `python main.py --listen 127.0.0.1 --port 8188`，如果要让局域网设备接入，把监听地址改成 `0.0.0.0`。",
              },
              {
                icon: Workflow,
                title: "建议先测 API",
                text: "先在 `/comfyui` 页里做服务器探测，确认 `system_stats / queue / object_info` 至少有一条能通，再提交 workflow。",
              },
              {
                icon: SquareTerminal,
                title: "最常见报错",
                text: "大多数失败都不是 FEICAI 侧的问题，而是 checkpoint 名不存在、节点缺失、工作流 JSON 结构和实际 ComfyUI 版本不匹配。",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="border border-[var(--border-default)] p-5">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className="text-[var(--gold-primary)]" />
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">{item.title}</span>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">{item.text}</p>
                </div>
              );
            })}
          </div>

          <section className="border border-[var(--border-default)] p-6">
            <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">接入步骤</h2>
            <div className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">
              <p>1. 启动 ComfyUI，并确保浏览器能打开类似 `http://127.0.0.1:8188` 的地址。</p>
              <p>2. 打开 FEICAI 的 `ComfyUI` 页面，把服务地址写进去，点击“探测”。</p>
              <p>3. 状态正常后，先载入示例 workflow，再把 `ckpt_name` 改成你本地真实存在的模型名。</p>
              <p>4. 提交成功后，ComfyUI 会返回 `prompt_id`，说明任务已经进入服务端队列。</p>
              <p>5. 后续可以把分镜、角色参考图、提示词拼装后映射成 ComfyUI workflow，实现真正的自动化编排。</p>
            </div>
          </section>

          <section className="border border-[var(--border-default)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">示例 Workflow</h2>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                  这是当前页面内置的最小工作流骨架，适合先测试 API 提交链路。
                </p>
              </div>
              <a
                href="https://github.com/comfyanonymous/ComfyUI"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-[13px] text-[var(--gold-primary)] hover:underline"
              >
                ComfyUI 官方仓库
                <ExternalLink size={14} />
              </a>
            </div>
            <pre className="mt-4 overflow-auto bg-[#0D0D0D] px-4 py-4 text-[12px] leading-6 text-[var(--text-secondary)]">
              {exampleJson}
            </pre>
          </section>
        </div>
      </main>
    </div>
  );
}
