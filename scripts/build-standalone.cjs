const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = process.env.FEICAI_DIST_DIR || '.next-standalone';
const tsconfigPath = path.join(root, 'tsconfig.json');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const syncScript = path.join(root, 'scripts', 'sync-standalone-static.cjs');

const originalTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
const env = {
  ...process.env,
  FEICAI_STANDALONE: '1',
  FEICAI_DIST_DIR: distDir,
};

let exitCode = 0;

try {
  const buildResult = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  if (buildResult.status !== 0) {
    exitCode = buildResult.status || 1;
  } else {
    const syncResult = spawnSync(process.execPath, [syncScript], {
      cwd: root,
      env,
      stdio: 'inherit',
    });

    if (syncResult.status !== 0) {
      exitCode = syncResult.status || 1;
    }
  }
} finally {
  const currentTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
  if (currentTsconfig !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, 'utf8');
    console.log('[build:standalone] restored tsconfig.json');
  }
}

process.exit(exitCode);
