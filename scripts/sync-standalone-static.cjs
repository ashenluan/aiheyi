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
