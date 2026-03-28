const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const nextDistDir = process.env.FEICAI_NEXT_DIST_DIR || '.next';
const standaloneOutputDir = process.env.FEICAI_STANDALONE_OUTPUT_DIR || process.env.FEICAI_DIST_DIR || '.next-standalone';
const tsconfigPath = path.join(root, 'tsconfig.json');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const syncScript = path.join(root, 'scripts', 'sync-standalone-static.cjs');
const standaloneOutputPath = path.join(root, standaloneOutputDir, 'standalone');

const originalTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
const env = {
  ...process.env,
  FEICAI_STANDALONE: '1',
  FEICAI_NEXT_DIST_DIR: nextDistDir,
  FEICAI_STANDALONE_OUTPUT_DIR: standaloneOutputDir,
};
delete env.FEICAI_DIST_DIR;

let exitCode = 0;

try {
  if (fs.existsSync(standaloneOutputPath)) {
    fs.rmSync(standaloneOutputPath, { recursive: true, force: true });
    console.log(`[build:standalone] cleared previous standalone output: ${standaloneOutputPath}`);
  }

  const typecheckResult = spawnSync(process.execPath, [tscBin, '--noEmit', '--pretty', 'false'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  if (typecheckResult.status !== 0) {
    exitCode = typecheckResult.status || 1;
  } else {
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
  }
} finally {
  const currentTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
  if (currentTsconfig !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, 'utf8');
    console.log('[build:standalone] restored tsconfig.json');
  }
}

process.exit(exitCode);
