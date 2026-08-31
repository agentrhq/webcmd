export type MemoryRevision = string;

export interface ProductIdentity {
  /** Filesystem-safe ASCII IDNA hostname used as the product directory key. */
  key: string;
  hostname: string;
  /** Unicode hostname retained for human-facing manifest output. */
  displayHostname: string;
  /** PSL-aware registrable-domain boundary for provisional fallback lookup. */
  registrableDomain: string;
}

export interface SeedPayload {
  revision: string;
  site: string;
  references?: Record<string, string>;
}

export type PersistedSeedResult =
  | { status: 'unattempted' }
  | { status: 'absent' }
  | { status: 'lookup-failed' }
  | { status: 'available'; revision: string };

export type SeedLookupResult =
  | Exclude<PersistedSeedResult, { status: 'available' }>
  | ({ status: 'available' } & SeedPayload);

export interface ProductManifest {
  schemaVersion: 1;
  product: ProductIdentity;
  /** Confirmed alternate hostnames belonging to this product. */
  interfaces: ProductIdentity[];
  seed: PersistedSeedResult;
}

export interface MemoryContext {
  resolution: ProductResolution;
  manifest?: ProductManifest;
  revision: MemoryRevision | null;
  siteMarkdown: string | null;
  references: { path: string }[];
  draftPath: string;
  readOnly: boolean;
  diagnostics: string[];
}

export type ProductResolutionStatus = 'exact' | 'confirmed-interface' | 'provisional-fallback' | 'new';

export interface ProductResolution {
  status: ProductResolutionStatus;
  requested: ProductIdentity;
  product: ProductIdentity;
  manifest?: ProductManifest;
  /** Only a provisional parent fallback is barred from writes. */
  readOnly: boolean;
}

export type CandidateStatus = 'pending' | 'ingested' | 'rejected';

export const CANDIDATE_KINDS = ['action_space', 'better_path', 'access', 'high_consequence', 'repeated_mistake'] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export interface CandidateEnvironment {
  machine?: string;
  localIp?: string;
  publicIp?: string;
  os?: string;
  browserVersion?: string;
  webcmdVersion?: string;
}

export interface Candidate {
  schemaVersion: 1;
  id: string;
  domain: string;
  hostname: string;
  observedAt: string;
  observedDateUtc: string;
  kind: string;
  claim: string;
  evidence: string;
  consequence: string;
  environment: CandidateEnvironment;
  status: CandidateStatus;
  evidenceRole: 'supporting' | 'dissenting' | null;
  memoryCommit: MemoryRevision | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface CandidateSummary {
  id: string;
  domain: string;
  hostname: string;
  observedAt: string;
  observedDateUtc: string;
  kind: string;
  claim: string;
  consequence: string;
  status: CandidateStatus;
}

export type CheckpointReason = 'candidate_ingestion' | 'direct_correction' | 'major_rewrite';

export interface CandidateDisposition {
  id: string;
  status: 'ingested' | 'rejected';
  evidenceRole?: 'supporting' | 'dissenting' | null;
  rejectionReason?: string | null;
  conflictsWithMemory?: boolean;
}

export type CheckpointResult =
  | { status: 'committed'; memoryCommit: MemoryRevision; provenanceCommit: MemoryRevision | null }
  | { status: 'conflict'; expectedRevision: MemoryRevision | null; actualRevision: MemoryRevision | null };

export type ClassifyDecision = 'same-product' | 'distinct';

export type ClassifyResult =
  | {
    status: 'classified';
    decision: ClassifyDecision;
    requested: ProductIdentity;
    product: ProductIdentity;
    existing: boolean;
    revision: MemoryRevision;
  }
  | { status: 'conflict'; expectedRevision: MemoryRevision | null; actualRevision: MemoryRevision | null };
