import type {
  CreateProvenanceManifestInput,
  ProvenanceAssetSummary,
  ProvenanceOutputFile,
} from "./types";

function tryReadSearchKey(input: string): string | undefined {
  try {
    const url = new URL(input, "http://localhost");
    return url.searchParams.get("key") || undefined;
  } catch {
    return undefined;
  }
}

export function summarizeAssetSource(input: string): string {
  if (!input) return "";
  if (input.startsWith("/api/grid-image?")) {
    return `grid-image:${tryReadSearchKey(input) || "unknown"}`;
  }
  if (input.startsWith("/api/local-file/videos/")) {
    return `local-video:${input.split("/").pop() || "unknown"}`;
  }
  if (input.startsWith("/api/local-file/video-frames/")) {
    return `local-frame:${input.split("/").pop() || "unknown"}`;
  }
  if (input.startsWith("data:")) {
    const mime = input.slice(5, input.indexOf(";")) || "data";
    return `${mime}:inline(${Math.round(input.length / 1024)}KB)`;
  }
  if (input.startsWith("blob:")) {
    return `blob:${input.slice(-24)}`;
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const url = new URL(input);
      return `${url.host}${url.pathname}${url.search ? "?..." : ""}`;
    } catch {
      return input.slice(0, 160);
    }
  }
  return input.slice(0, 160);
}

export function summarizeAssetList(
  items: Array<string | { label?: string; url: string; key?: string }>,
): ProvenanceAssetSummary[] {
  return items
    .map((item) => {
      if (typeof item === "string") {
        const source = summarizeAssetSource(item);
        return source ? { source } : null;
      }
      const source = summarizeAssetSource(item.url);
      if (!source) return null;
      return {
        label: item.label,
        key: item.key,
        source,
      };
    })
    .filter((item): item is ProvenanceAssetSummary => Boolean(item));
}

export function buildOutputEntries(
  category: string,
  items: Array<{ key: string; url?: string; path?: string; label?: string }>,
): ProvenanceOutputFile[] {
  return items
    .filter((item) => item.key)
    .map((item) => ({
      category,
      key: item.key,
      url: item.url,
      path: item.path,
      label: item.label,
    }));
}

export async function persistProvenanceManifest(input: CreateProvenanceManifestInput) {
  const res = await fetch("/api/provenance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`provenance ${res.status}`);
  }
  return res.json();
}
