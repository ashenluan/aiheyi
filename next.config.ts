import type { NextConfig } from "next";
import { resolve } from "path";

const useStandalone = process.env.FEICAI_STANDALONE === "1";
const distDir = process.env.FEICAI_NEXT_DIST_DIR || process.env.FEICAI_DIST_DIR || ".next";

const nextConfig: NextConfig = {
  output: useStandalone ? "standalone" : undefined,
  distDir,
  cleanDistDir: false,
  devIndicators: false,
  experimental: {
    webpackBuildWorker: useStandalone ? false : undefined,
  },
  typescript: {
    ignoreBuildErrors: useStandalone,
  },
  turbopack: {
    root: resolve(__dirname),
  },
};

export default nextConfig;
