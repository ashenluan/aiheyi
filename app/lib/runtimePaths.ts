import fs from "fs";
import path from "path";

function hasProjectMarkers(dir: string): boolean {
  return fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "server.js"));
}

export function resolveProjectRoot(cwd = process.cwd()): string {
  const normalized = path.resolve(cwd);
  const standaloneSuffix = `${path.sep}.next${path.sep}standalone`;

  if (normalized.endsWith(standaloneSuffix)) {
    return path.resolve(normalized, "..", "..");
  }

  if (hasProjectMarkers(normalized)) return normalized;

  const liftedOne = path.resolve(normalized, "..");
  if (hasProjectMarkers(liftedOne)) return liftedOne;

  const liftedTwo = path.resolve(normalized, "..", "..");
  if (hasProjectMarkers(liftedTwo)) return liftedTwo;

  return normalized;
}

export function resolveProjectFile(...segments: string[]): string {
  return path.join(resolveProjectRoot(), ...segments);
}

export function ensureProjectDir(...segments: string[]): string {
  const dir = resolveProjectFile(...segments);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
