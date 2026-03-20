import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "./components/Toast";
import { TaskQueueProvider } from "./lib/taskQueue";
import { PipelineProvider } from "./lib/pipelineContext";
import TaskQueuePanel from "./components/TaskQueuePanel";
import AgentFAB from "./components/AgentFAB";
import LicenseGuard from "./components/LicenseGuard";
import ThemeSync from "./components/ThemeSync";

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--nf-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--nf-ui",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--nf-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FEICAI Studio",
  description: "AI-powered storyboard generation studio",
};

const themeBootScript = `(() => {
  try {
    const raw = localStorage.getItem("feicai-settings");
    const parsed = raw ? JSON.parse(raw) : {};
    const theme = parsed && typeof parsed["ui-theme"] === "string" ? parsed["ui-theme"] : "classic-gold";
    const valid = ["classic-gold", "ocean-ink", "jade-night", "crimson-noir", "paper-amber", "sky-atelier"];
    const root = document.documentElement;
    if (root) root.dataset.uiTheme = valid.includes(theme) ? theme : "classic-gold";
  } catch {
    const root = document.documentElement;
    if (root) root.dataset.uiTheme = "classic-gold";
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`h-full ${cormorantGaramond.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="h-full overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)] font-ui antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <TaskQueueProvider>
          <ToastProvider>
            <PipelineProvider>
              <ThemeSync />
              <LicenseGuard>
                {children}
                <TaskQueuePanel />
                <AgentFAB />
              </LicenseGuard>
            </PipelineProvider>
          </ToastProvider>
        </TaskQueueProvider>
      </body>
    </html>
  );
}
