export const GENERATION_JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

export type GenerationJobStatus =
  (typeof GENERATION_JOB_STATUS)[keyof typeof GENERATION_JOB_STATUS];

export const ACTIVE_GENERATION_JOB_STATUSES: readonly GenerationJobStatus[] = [
  GENERATION_JOB_STATUS.PENDING,
  GENERATION_JOB_STATUS.PROCESSING,
] as const;

export const TERMINAL_GENERATION_JOB_STATUSES: readonly GenerationJobStatus[] = [
  GENERATION_JOB_STATUS.COMPLETED,
  GENERATION_JOB_STATUS.ERROR,
  GENERATION_JOB_STATUS.CANCELLED,
] as const;

const TRANSITIONS: Record<GenerationJobStatus, readonly GenerationJobStatus[]> = {
  [GENERATION_JOB_STATUS.PENDING]: [
    GENERATION_JOB_STATUS.PROCESSING,
    GENERATION_JOB_STATUS.COMPLETED,
    GENERATION_JOB_STATUS.ERROR,
    GENERATION_JOB_STATUS.CANCELLED,
  ],
  [GENERATION_JOB_STATUS.PROCESSING]: [
    GENERATION_JOB_STATUS.COMPLETED,
    GENERATION_JOB_STATUS.ERROR,
    GENERATION_JOB_STATUS.CANCELLED,
  ],
  [GENERATION_JOB_STATUS.COMPLETED]: [],
  [GENERATION_JOB_STATUS.ERROR]: [],
  [GENERATION_JOB_STATUS.CANCELLED]: [],
};

export function normalizeGenerationJobStatus(
  raw: string | null | undefined,
): GenerationJobStatus | null {
  if (!raw) return null;
  const value = raw.toLowerCase() as GenerationJobStatus;
  return value in TRANSITIONS ? value : null;
}

export function isActiveGenerationJobStatus(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeGenerationJobStatus(status);
  return normalized !== null && ACTIVE_GENERATION_JOB_STATUSES.includes(normalized);
}

export function canTransitionGenerationJobStatus(
  from: string | null | undefined,
  to: GenerationJobStatus,
): boolean {
  const normalizedFrom = normalizeGenerationJobStatus(from);
  if (!normalizedFrom) return false;
  if (normalizedFrom === to) return true;
  return TRANSITIONS[normalizedFrom].includes(to);
}

