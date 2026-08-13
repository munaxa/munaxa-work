import {
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  EMPLOYMENT,
  POSITION,
  type PoolLike,
} from './career-database.fixture.js';

/**
 * The inserts the schema suites share, as SQL rather than through a repository.
 *
 * There is no repository yet — this checkpoint is the schema and nothing above it — and that is the
 * right shape for these probes anyway: each one asserts what the *database* refuses, so the
 * statement it refuses has to be one the database saw, not one a repository composed.
 *
 * Every helper returns the identifier PostgreSQL generated, so a caller never invents a uuid and
 * `app_uuid_v7()` stays the single source of them.
 */

const idOf = async (client: PoolLike, sql: string, values: readonly unknown[]): Promise<string> => {
  const written = await client.query<{ id: string }>(sql, values);
  const row = written.rows[0];

  if (row === undefined) throw new Error(`Insert returned no row: ${sql}`);
  return row.id;
};

export const insertPath = (
  client: PoolLike,
  tenantId: string,
  overrides: { code?: string; status?: string } = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_path
       (tenant_id, code, name, kind, status, effective_from, ${AUDIT_COLUMNS})
     values ($1, $2, '{"en":"Engineering"}'::jsonb, 'technical', $3, date '2026-01-01',
             ${AUDIT_VALUES})
     returning id`,
    [tenantId, overrides.code ?? 'engineering', overrides.status ?? 'published'],
  );

export const insertStage = (
  client: PoolLike,
  tenantId: string,
  pathId: string,
  sequence: number,
): Promise<string> =>
  idOf(
    client,
    `insert into career_stage (tenant_id, path_id, sequence, name, ${AUDIT_COLUMNS})
     values ($1, $2, $3, '{"en":"Senior"}'::jsonb, ${AUDIT_VALUES})
     returning id`,
    [tenantId, pathId, sequence],
  );

export interface PlanOverrides {
  readonly employmentId?: string;
  readonly status?: string;
  readonly startedOn?: string;
  readonly targetDate?: string | null;
  readonly closedOn?: string | null;
  readonly closedBy?: string | null;
}

export const insertPlan = (
  client: PoolLike,
  tenantId: string,
  overrides: PlanOverrides = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_plan
       (tenant_id, employment_id, status, started_on, target_date, closed_on, closed_by,
        ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4::date, $5::date, $6::date, $7, ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      overrides.employmentId ?? EMPLOYMENT,
      overrides.status ?? 'active',
      overrides.startedOn ?? '2026-03-01',
      overrides.targetDate ?? null,
      overrides.closedOn ?? null,
      overrides.closedBy ?? null,
    ],
  );

export const insertPool = (
  client: PoolLike,
  tenantId: string,
  code = 'graduates',
): Promise<string> =>
  idOf(
    client,
    `insert into career_talent_pool (tenant_id, code, name, kind, status, ${AUDIT_COLUMNS})
     values ($1, $2, '{"en":"Graduates"}'::jsonb, 'graduate', 'active', ${AUDIT_VALUES})
     returning id`,
    [tenantId, code],
  );

export interface MembershipOverrides {
  readonly employmentId?: string;
  readonly fromDate?: string;
  readonly toDate?: string | null;
  readonly removedBy?: string | null;
}

export const insertMembership = (
  client: PoolLike,
  tenantId: string,
  poolId: string,
  overrides: MembershipOverrides = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_pool_membership
       (tenant_id, talent_pool_id, employment_id, from_date, to_date, added_by, removed_by,
        ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4::date, $5::date, 'user:test', $6, ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      poolId,
      overrides.employmentId ?? EMPLOYMENT,
      overrides.fromDate ?? '2026-01-05',
      overrides.toDate ?? null,
      overrides.removedBy ?? null,
    ],
  );

export const insertReadinessLevel = (
  client: PoolLike,
  tenantId: string,
  overrides: { code?: string; ordinal?: number } = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_readiness_level (tenant_id, code, name, ordinal, active, ${AUDIT_COLUMNS})
     values ($1, $2, '{"en":"Ready now"}'::jsonb, $3, true, ${AUDIT_VALUES})
     returning id`,
    [tenantId, overrides.code ?? 'ready-now', overrides.ordinal ?? 4],
  );

export const insertSuccessionPlan = (
  client: PoolLike,
  tenantId: string,
  overrides: { positionId?: string; status?: string; reviewOn?: string | null } = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_succession_plan
       (tenant_id, position_id, status, review_on, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4::date, ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      overrides.positionId ?? POSITION,
      overrides.status ?? 'active',
      overrides.reviewOn ?? null,
    ],
  );

export interface SuccessorOverrides {
  readonly employmentId?: string;
  readonly status?: string;
  readonly rank?: number | null;
  readonly nominatedBy?: string;
  readonly confirmedOn?: string | null;
  readonly confirmedBy?: string | null;
  readonly withdrawnOn?: string | null;
  readonly withdrawnBy?: string | null;
  readonly withdrawalReason?: string | null;
}

/** A nomination's defaults, stated once so the insert itself stays a single expression. */
const SUCCESSOR_DEFAULTS = {
  employmentId: EMPLOYMENT,
  status: 'nominated',
  rank: null,
  nominatedBy: 'user:head-of-hr',
  confirmedOn: null,
  confirmedBy: null,
  withdrawnOn: null,
  withdrawnBy: null,
  withdrawalReason: null,
} satisfies Required<SuccessorOverrides>;

export const insertSuccessor = (
  client: PoolLike,
  tenantId: string,
  planId: string,
  overrides: SuccessorOverrides = {},
): Promise<string> => {
  const row = { ...SUCCESSOR_DEFAULTS, ...overrides };

  return idOf(
    client,
    `insert into career_successor
       (tenant_id, succession_plan_id, employment_id, rank, status, nominated_on, nominated_by,
        confirmed_on, confirmed_by, withdrawn_on, withdrawn_by, withdrawal_reason, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, $5, date '2026-04-01', $6, $7::date, $8, $9::date, $10, $11,
             ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      planId,
      row.employmentId,
      row.rank,
      row.status,
      row.nominatedBy,
      row.confirmedOn,
      row.confirmedBy,
      row.withdrawnOn,
      row.withdrawnBy,
      row.withdrawalReason,
    ],
  );
};

export interface AssessmentOverrides {
  readonly employmentId?: string;
  readonly positionId?: string | null;
  readonly successionPlanId?: string | null;
  readonly assessedOn?: string;
  readonly assessedBy?: string;
}

export const insertAssessment = (
  client: PoolLike,
  tenantId: string,
  levelId: string,
  overrides: AssessmentOverrides = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_readiness_assessment
       (tenant_id, employment_id, readiness_level_id, position_id, succession_plan_id, assessed_on,
        assessed_by, recorded_at, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, $5, $6::date, $7, now(), ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      overrides.employmentId ?? EMPLOYMENT,
      levelId,
      overrides.positionId === undefined ? POSITION : overrides.positionId,
      overrides.successionPlanId ?? null,
      overrides.assessedOn ?? '2026-05-04',
      overrides.assessedBy ?? 'user:head-of-hr',
    ],
  );

export const insertDevelopmentPlan = (
  client: PoolLike,
  tenantId: string,
  overrides: { status?: string; startedOn?: string } = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_development_plan
       (tenant_id, employment_id, status, started_on, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4::date, ${AUDIT_VALUES})
     returning id`,
    [tenantId, EMPLOYMENT, overrides.status ?? 'active', overrides.startedOn ?? '2026-02-01'],
  );

export interface ItemOverrides {
  readonly category?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly learningAssignmentId?: string | null;
  readonly completedOn?: string | null;
  readonly completedBy?: string | null;
}

export const insertDevelopmentItem = (
  client: PoolLike,
  tenantId: string,
  planId: string,
  overrides: ItemOverrides = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_development_item
       (tenant_id, development_plan_id, category, kind, title, learning_assignment_id, status,
        completed_on, completed_by, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, 'Lead the migration', $5, $6, $7::date, $8, ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      planId,
      overrides.category ?? 'experience',
      overrides.kind ?? 'project',
      overrides.learningAssignmentId ?? null,
      overrides.status ?? 'planned',
      overrides.completedOn ?? null,
      overrides.completedBy ?? null,
    ],
  );

export interface MobilityOverrides {
  readonly status?: string;
  readonly recommendedOn?: string;
  readonly recommendedBy?: string;
  readonly validUntil?: string | null;
  readonly decidedOn?: string | null;
  readonly decidedBy?: string | null;
}

export const insertMobility = (
  client: PoolLike,
  tenantId: string,
  overrides: MobilityOverrides = {},
): Promise<string> =>
  idOf(
    client,
    `insert into career_mobility_recommendation
       (tenant_id, employment_id, kind, target_position_id, status, recommended_on, recommended_by,
        valid_until, decided_on, decided_by, ${AUDIT_COLUMNS})
     values ($1, $2, 'lateral_move', $3, $4, $5::date, $6, $7::date, $8::date, $9, ${AUDIT_VALUES})
     returning id`,
    [
      tenantId,
      EMPLOYMENT,
      POSITION,
      overrides.status ?? 'proposed',
      overrides.recommendedOn ?? '2026-06-01',
      overrides.recommendedBy ?? 'user:head-of-hr',
      overrides.validUntil ?? null,
      overrides.decidedOn ?? null,
      overrides.decidedBy ?? null,
    ],
  );
