const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '.next', 'static');
const dst = path.join(root, '.next', 'standalone', '.next', 'static');

if (!fs.existsSync(src)) {
  console.log('[postbuild] skip: missing source static dir');
  process.exit(0);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.cpSync(src, dst, { recursive: true, force: true });
console.log(`[postbuild] synced standalone static: ${src} -> ${dst}`);
