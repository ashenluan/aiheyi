import { LicenseVerificationError } from "./errors";
import { MemoryLicenseCache, type LicenseCache } from "./licenseCache";
import { DelegatingLicenseVerifier, type LicenseVerifier, normalizeActivationCode } from "./licenseVerifier";
import { LocalAppDataLicenseRepository, type LicenseRepository } from "./licenseRepository";
import { MachineFingerprintService } from "./machineFingerprint";
import type {
  LicenseState,
  LicenseStatus,
  StoredLicenseRecord,
  VerificationResult,
} from "./types";

export interface LicenseServiceOptions {
  fingerprintService?: MachineFingerprintService;
  repository?: LicenseRepository;
  verifier?: LicenseVerifier;
  cache?: LicenseCache;
  now?: () => Date;
}

function buildStatus(
  machineCode: string,
  state: LicenseState,
  details: Partial<LicenseStatus> = {},
  now = new Date(),
): LicenseStatus {
  return {
    activated: state === "activated",
    state,
    machineCode,
    checkedAt: now.toISOString(),
    ...details,
  };
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export class LicenseService {
  private readonly fingerprintService: MachineFingerprintService;
  private readonly repository: LicenseRepository;
  private readonly verifier: LicenseVerifier;
  private readonly cache: LicenseCache;
  private readonly now: () => Date;

  constructor(options: LicenseServiceOptions = {}) {
    this.fingerprintService = options.fingerprintService ?? new MachineFingerprintService();
    this.repository = options.repository ?? new LocalAppDataLicenseRepository();
    this.verifier =
      options.verifier ??
      new DelegatingLicenseVerifier(async () => ({
        valid: false,
        reason: "invalid",
        error: "当前授权校验服务未配置，请接入可用的校验器。",
      }));
    this.cache = options.cache ?? new MemoryLicenseCache();
    this.now = options.now ?? (() => new Date());
  }

  async getStatus(): Promise<LicenseStatus> {
    const cached = this.cache.get();
    if (cached) {
      return cached;
    }

    const snapshot = await this.fingerprintService.getSnapshot();

    try {
      const record = await this.repository.load();
      if (!record) {
        return this.remember(
          buildStatus(snapshot.primaryMachineCode, "unlicensed", {}, this.now()),
        );
      }

      const verification = await this.verifier.verify({
        activationCode: record.activationCode,
        machineCodes: unique([record.machineCode, ...snapshot.candidateMachineCodes]),
      });

      if (verification.valid && !record.machineCode && verification.matchedMachineCode) {
        await this.repository.save({
          activationCode: record.activationCode,
          machineCode: verification.matchedMachineCode,
        });
      }

      if (
        !verification.valid &&
        record.machineCode &&
        !snapshot.candidateMachineCodes.includes(record.machineCode)
      ) {
        return this.remember(
          buildStatus(
            snapshot.primaryMachineCode,
            "mismatch",
            { error: "授权文件与当前设备不匹配" },
            this.now(),
          ),
        );
      }

      return this.remember(
        this.mapVerification(snapshot.primaryMachineCode, verification),
      );
    } catch (error) {
      return this.remember(
        buildStatus(
          snapshot.primaryMachineCode,
          "error",
          {
            error: error instanceof Error ? error.message : "授权状态检查失败",
          },
          this.now(),
        ),
      );
    }
  }

  async activate(activationCodeInput: string): Promise<LicenseStatus> {
    const activationCode = normalizeActivationCode(activationCodeInput);
    const snapshot = await this.fingerprintService.getSnapshot();

    if (!activationCode) {
      return buildStatus(
        snapshot.primaryMachineCode,
        "invalid",
        { error: "请输入激活码" },
        this.now(),
      );
    }

    let verification: VerificationResult;
    try {
      verification = await this.verifier.verify({
        activationCode,
        machineCodes: snapshot.candidateMachineCodes,
      });
    } catch (error) {
      throw new LicenseVerificationError("授权校验执行失败", error);
    }

    const status = this.mapVerification(snapshot.primaryMachineCode, verification);
    if (!status.activated) {
      this.cache.clear();
      return status;
    }

    const record: StoredLicenseRecord = {
      activationCode,
      machineCode: verification.matchedMachineCode ?? snapshot.primaryMachineCode,
    };

    await this.repository.save(record);
    return this.remember(status);
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  private mapVerification(
    machineCode: string,
    verification: VerificationResult,
  ): LicenseStatus {
    if (verification.valid) {
      return buildStatus(
        machineCode,
        "activated",
        {
          expiry: verification.expiry,
          daysLeft: verification.daysLeft,
        },
        this.now(),
      );
    }

    return buildStatus(
      machineCode,
      verification.reason ?? "invalid",
      {
        expiry: verification.expiry,
        daysLeft: verification.daysLeft,
        error: verification.error,
      },
      this.now(),
    );
  }

  private remember(status: LicenseStatus): LicenseStatus {
    this.cache.set(status);
    return status;
  }
}
