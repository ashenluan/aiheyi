export type ProvenanceKind = "studio-image" | "video";

export interface ProvenanceAssetSummary {
  label?: string;
  source: string;
  key?: string;
}

export interface ProvenanceOutputFile {
  category: string;
  key?: string;
  url?: string;
  path?: string;
  label?: string;
}

export interface ProvenanceManifest {
  schemaVersion: 1;
  kind: ProvenanceKind;
  title: string;
  stage: string;
  episode: string;
  createdAt: string;
  createdAtUnix: number;
  projectId: string;
  prompt?: string;
  promptPreview?: string;
  model?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  outputs: ProvenanceOutputFile[];
  context?: Record<string, unknown>;
}

export interface CreateProvenanceManifestInput {
  kind: ProvenanceKind;
  title: string;
  stage: string;
  episode: string;
  prompt?: string;
  model?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  outputs: ProvenanceOutputFile[];
  context?: Record<string, unknown>;
}
