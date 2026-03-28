const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDistDir = process.env.FEICAI_NEXT_DIST_DIR || process.env.FEICAI_DIST_DIR || '.next';
const outputDistDir = process.env.FEICAI_STANDALONE_OUTPUT_DIR || process.env.FEICAI_DIST_DIR || sourceDistDir;
const src = path.join(root, sourceDistDir, 'static');
const standaloneSource = path.join(root, sourceDistDir, 'standalone');
const standaloneRoot = path.join(root, outputDistDir, 'standalone');
const targets = [
  path.join(standaloneRoot, '.next', 'static'),
  ...(sourceDistDir !== '.next' ? [path.join(standaloneRoot, sourceDistDir, 'static')] : []),
];
const publicSrc = path.join(root, 'public');
const publicDst = path.join(standaloneRoot, 'public');
const mirroredDirs = [
  {
    src: path.join(root, 'GeminiTab-dist'),
    dst: path.join(standaloneRoot, 'GeminiTab-dist'),
    excludeNames: new Set(['browser-data', 'debug-screenshots', 'temp-uploads']),
  },
  {
    src: path.join(root, 'ms-playwright'),
    dst: path.join(standaloneRoot, 'ms-playwright'),
    excludeNames: new Set(),
  },
];
const mirroredFiles = [
  {
    src: path.join(root, 'node.exe'),
    dst: path.join(standaloneRoot, 'node.exe'),
  },
];
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

function copyDirExclude(srcDir, dstDir, excludeNames = new Set()) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirExclude(srcPath, dstPath, excludeNames);
    } else {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.cpSync(srcPath, dstPath, { force: true });
    }
  }
}

if (!fs.existsSync(src)) {
  console.log('[postbuild] skip: missing source static dir');
  process.exit(0);
}

if (!fs.existsSync(standaloneSource)) {
  console.log('[postbuild] skip: source standalone output not present');
  process.exit(0);
}

fs.mkdirSync(path.dirname(standaloneRoot), { recursive: true });
if (standaloneSource !== standaloneRoot) {
  fs.cpSync(standaloneSource, standaloneRoot, { recursive: true, force: true });
  console.log(`[postbuild] copied standalone bundle: ${standaloneSource} -> ${standaloneRoot}`);
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

for (const dir of mirroredDirs) {
  if (!fs.existsSync(dir.src)) continue;
  copyDirExclude(dir.src, dir.dst, dir.excludeNames);
  console.log(`[postbuild] synced standalone dir: ${dir.src} -> ${dir.dst}`);
}

for (const file of mirroredFiles) {
  if (!fs.existsSync(file.src)) continue;
  fs.mkdirSync(path.dirname(file.dst), { recursive: true });
  fs.cpSync(file.src, file.dst, { force: true });
  console.log(`[postbuild] synced standalone file: ${file.src} -> ${file.dst}`);
}

for (const asset of rootAssets) {
  const srcAsset = path.join(root, asset);
  const dstAsset = path.join(standaloneRoot, asset);
  if (!fs.existsSync(srcAsset)) continue;
  fs.mkdirSync(path.dirname(dstAsset), { recursive: true });
  fs.cpSync(srcAsset, dstAsset, { force: true });
  console.log(`[postbuild] synced standalone asset: ${srcAsset} -> ${dstAsset}`);
}
