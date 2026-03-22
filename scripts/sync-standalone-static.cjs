const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = process.env.FEICAI_DIST_DIR || '.next';
const src = path.join(root, distDir, 'static');
const standaloneRoot = path.join(root, distDir, 'standalone');
const targets = [
  path.join(standaloneRoot, distDir, 'static'),
  path.join(standaloneRoot, '.next', 'static'),
];
const publicSrc = path.join(root, 'public');
const publicDst = path.join(standaloneRoot, 'public');
const rootAssets = [
  '.version',
  'CHANGELOG.md',
  '9宫格分镜Gem.txt',
  '4宫格分镜Gem.txt',
  '25宫格分镜Gem.txt',
  'Gemini生图专用Gem.txt',
  '提取系统提示词.txt',
  '使用说明.md',
];

if (!fs.existsSync(src)) {
  console.log('[postbuild] skip: missing source static dir');
  process.exit(0);
}

if (!fs.existsSync(standaloneRoot)) {
  console.log('[postbuild] skip: standalone output not present');
  process.exit(0);
}

for (const dst of targets) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  console.log(`[postbuild] synced standalone static: ${src} -> ${dst}`);
}

if (fs.existsSync(publicSrc)) {
  fs.mkdirSync(publicDst, { recursive: true });
  fs.cpSync(publicSrc, publicDst, { recursive: true, force: true });
  console.log(`[postbuild] synced standalone public: ${publicSrc} -> ${publicDst}`);
}

for (const asset of rootAssets) {
  const srcAsset = path.join(root, asset);
  const dstAsset = path.join(standaloneRoot, asset);
  if (!fs.existsSync(srcAsset)) continue;
  fs.mkdirSync(path.dirname(dstAsset), { recursive: true });
  fs.cpSync(srcAsset, dstAsset, { force: true });
  console.log(`[postbuild] synced standalone asset: ${srcAsset} -> ${dstAsset}`);
}
