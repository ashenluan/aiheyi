import type { LicenseStatus } from "./types";

export interface LicenseCache {
  get(): LicenseStatus | null;
  set(status: LicenseStatus): void;
  clear(): void;
}

interface CacheEntry {
  status: LicenseStatus;
  checkedAtMs: number;
}

export class MemoryLicenseCache implements LicenseCache {
  private entry: CacheEntry | null = null;

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  get(): LicenseStatus | null {
    if (!this.entry) {
      return null;
    }

    if (Date.now() - this.entry.checkedAtMs > this.ttlMs) {
      this.entry = null;
      return null;
    }

    return this.entry.status;
  }

  set(status: LicenseStatus): void {
    this.entry = {
      status,
      checkedAtMs: Date.now(),
    };
  }

  clear(): void {
    this.entry = null;
  }
}
