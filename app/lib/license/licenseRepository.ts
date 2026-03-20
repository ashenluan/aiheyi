import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LicenseStorageError } from "./errors";
import type { StoredLicenseRecord } from "./types";

export interface LicenseRepository {
  getDirectoryPath(): string;
  getFilePath(): string;
  load(): Promise<StoredLicenseRecord | null>;
  save(record: StoredLicenseRecord): Promise<void>;
  clear(): Promise<void>;
}

export class LocalAppDataLicenseRepository implements LicenseRepository {
  constructor(
    private readonly applicationDirectory = "FEICAI-Studio",
    private readonly fileName = ".license",
  ) {}

  getDirectoryPath(): string {
    const localAppData =
      process.env.LOCALAPPDATA ??
      join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local");

    return join(localAppData, this.applicationDirectory);
  }

  getFilePath(): string {
    return join(this.getDirectoryPath(), this.fileName);
  }

  async load(): Promise<StoredLicenseRecord | null> {
    const filePath = this.getFilePath();

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const lines = readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return null;
      }

      return {
        activationCode: lines[0].toUpperCase(),
        machineCode: lines[1]?.toUpperCase(),
      };
    } catch (error) {
      throw new LicenseStorageError("读取授权文件失败", error);
    }
  }

  async save(record: StoredLicenseRecord): Promise<void> {
    try {
      mkdirSync(this.getDirectoryPath(), { recursive: true });

      const lines = [record.activationCode.trim().toUpperCase()];
      if (record.machineCode?.trim()) {
        lines.push(record.machineCode.trim().toUpperCase());
      }

      writeFileSync(this.getFilePath(), lines.join("\n"), "utf8");
    } catch (error) {
      throw new LicenseStorageError("保存授权文件失败", error);
    }
  }

  async clear(): Promise<void> {
    try {
      rmSync(this.getFilePath(), { force: true });
    } catch (error) {
      throw new LicenseStorageError("删除授权文件失败", error);
    }
  }
}
