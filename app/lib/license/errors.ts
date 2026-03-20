export class LicenseStorageError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LicenseStorageError";
    this.cause = cause;
  }
}

export class LicenseVerificationError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LicenseVerificationError";
    this.cause = cause;
  }
}
