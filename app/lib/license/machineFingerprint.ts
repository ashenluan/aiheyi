import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";

import type { MachineFingerprintSnapshot } from "./types";

const VIRTUAL_INTERFACE_HINTS = [
  "virtual",
  "vpn",
  "tap",
  "wireguard",
  "hyper-v",
  "tunnel",
  "vethernet",
];

function runPowerShell(command: string): string {
  try {
    return execSync(`powershell -NoProfile -Command "${command}"`, {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function runCimQuery(className: string, property: string, where?: string): string {
  const query = [
    `SELECT ${property} FROM ${className}`,
    where ? `WHERE ${where}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return runPowerShell(
    `Get-CimInstance -Query '${query}' | Select-Object -ExpandProperty ${property} -First 1`,
  );
}

function normalizeMac(value: string): string {
  return value.trim().toUpperCase();
}

function isVirtualAdapter(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return VIRTUAL_INTERFACE_HINTS.some((hint) => normalized.includes(hint));
}

function getPhysicalMacsFromCim(): string[] {
  const output = runPowerShell(
    "Get-CimInstance -Query 'SELECT MACAddress, Name FROM Win32_NetworkAdapter WHERE MACAddress IS NOT NULL AND PhysicalAdapter=TRUE' | ForEach-Object { $_.MACAddress + '|' + $_.Name }",
  );

  if (!output) {
    return [];
  }

  const macs = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [macAddress = "", name = ""] = line.split("|");
      return { macAddress: normalizeMac(macAddress), name };
    })
    .filter(({ macAddress, name }) => macAddress && !isVirtualAdapter(name))
    .map(({ macAddress }) => macAddress)
    .sort();

  return [...new Set(macs)];
}

function getPhysicalMacsFromNode(): string[] {
  const interfaces = networkInterfaces();
  const macs: string[] = [];

  for (const [name, items] of Object.entries(interfaces)) {
    if (!items || isVirtualAdapter(name)) {
      continue;
    }

    for (const item of items) {
      if (!item.mac || item.mac === "00:00:00:00:00:00" || item.internal) {
        continue;
      }

      macs.push(normalizeMac(item.mac));
    }
  }

  return [...new Set(macs.sort())];
}

function buildMachineCode(cpuId: string, macAddress: string, diskSerial: string): string {
  let seed = `${cpuId}|${macAddress}|${diskSerial}`.trim();

  if (!seed || seed === "||") {
    seed = `${process.env.COMPUTERNAME ?? "UNKNOWN"}|${process.env.USERNAME ?? "user"}`;
  }

  const digest = createHash("sha256")
    .update(seed)
    .digest("hex")
    .substring(0, 16)
    .toUpperCase();

  return [
    digest.substring(0, 4),
    digest.substring(4, 8),
    digest.substring(8, 12),
    digest.substring(12, 16),
  ].join("-");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class MachineFingerprintService {
  async getSnapshot(): Promise<MachineFingerprintSnapshot> {
    const cpuId = runCimQuery("Win32_Processor", "ProcessorId");
    const diskSerial = runCimQuery("Win32_DiskDrive", "SerialNumber");
    const macCandidates = unique([
      ...getPhysicalMacsFromCim(),
      ...getPhysicalMacsFromNode(),
      runPowerShell(
        "Get-CimInstance -Query 'SELECT MACAddress FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=TRUE' | Select-Object -ExpandProperty MACAddress",
      ),
    ]);

    const machineCodes = unique(
      (macCandidates.length > 0 ? macCandidates : [""]).map((macAddress) =>
        buildMachineCode(cpuId, macAddress, diskSerial),
      ),
    );

    const primaryMachineCode =
      machineCodes[0] ?? buildMachineCode(cpuId, "", diskSerial);

    return {
      primaryMachineCode,
      candidateMachineCodes: unique([primaryMachineCode, ...machineCodes]),
    };
  }
}
