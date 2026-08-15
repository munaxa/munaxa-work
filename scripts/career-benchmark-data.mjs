/**
 * Seeding one tenant's whole career and succession position, for
 * `measure-career-performance.mjs`.
 *
 * Split from the measurements for the reason the file-size budget exists: what a benchmark *reads*
 * and how its fixture was *built* are two different concerns, and a reader checking whether the
 * succession queue is measured honestly should not have to scroll past three hundred lines of
 * inserts to find it. Split again from `career-benchmark-records.mjs` along the seam between the
 * **configuration** a tenant of any size has and the **records** that grow with its workforce.
 *
 * Deliberately **not** through the command handlers: seeding a hundred thousand career plans through
 * the dispatcher would measure the seeding rather than the reads, and the reads are the point. The
 * rows written here are the rows the handlers write — same columns, same constraints, same triggers,
 * same check constraints, same partial unique indexes. Anything the domain would have refused,
 * PostgreSQL refuses here too.
 *
 * **The proportions are the ones a real workforce has**, because selectivity is what a query plan
 * turns on. A population where everybody is on an active career plan measures a different index from
 * one where a third are, and the second is the case a succession screen is opened to see. So: about
 * a third of employments carry a career plan, a tenth sit in a talent pool, a twentieth are
 * nominated somewhere, a tenth have a development plan, and a twentieth have a recommendation open.
 *
 * **No impossible state is created to inflate a row count.** Every successor names a succession plan
 * that exists, every membership names a pool, every development item names a plan, every readiness
 * assessment names both a level and a subject, and every confirmed successor carries the day and the
 * named human who confirmed it — `career_successor_confirmation_check` refuses `system:auto-approval`
 * here exactly as it refuses it in production.
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';

import {
  seedAssessments,
  seedDevelopment,
  seedItems,
  seedMemberships,
  seedPlans,
  seedRecommendations,
  seedSuccession,
  seedSuccessors,
} from './career-benchmark-records.mjs';

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * The configuration every tier shares.
 *
 * Fixed rather than scaled with the workforce, because a tenant's configuration does not grow with
 * its headcount: a company of a hundred thousand runs the same handful of career ladders and talent
 * pools as one of five hundred, and the reads that scale are the ones over what people did with
 * them.
 *
 * `POSITIONS` is the one number the plan asks to be watched. Bench strength across many positions is
 * an O(n×m) risk of exactly the kind Phase 13 hit, so the fixture gives a hundred thousand
 * employments **four hundred** succession plans rather than four — enough that a per-position read
 * would show up as a slope rather than as noise.
 */
const PATHS = 6;
const STAGES_PER_PATH = 5;
const POOLS = 8;
const LEVELS = 5;
const POSITIONS = 400;

/** The day the fixture is built around. Stated, never taken from the wall clock. */
export const TODAY = '2026-08-14';

export const chunked = async (rows, size, write) => {
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
};

/** One multi-row insert per chunk. `unnest` would need a type per column; this is plainer. */
export const insertAll = async (admin, table, columns, rows) => {
  if (rows.length === 0) return;

  await chunked(rows, 1_000, async (batch) => {
    const width = columns.length;
    const values = batch
      .map(
        (_, row) =>
          `(${columns.map((__, column) => `$${String(row * width + column + 1)}`).join(', ')}, ${AUDIT})`,
      )
      .join(', ');

    await admin.query(
      `insert into ${table} (${columns.join(', ')}, created_at, created_by, updated_at, updated_by, version)
       values ${values}`,
      batch.flat(),
    );
  });
};

export const seedTenant = async (admin, tenantId, employments) => {
  const paths = await seedPaths(admin, tenantId);
  const pools = await seedPools(admin, tenantId);
  const levels = await seedLevels(admin, tenantId);
  const people = Array.from({ length: employments }, () => uuidV7());
  const positions = Array.from({ length: POSITIONS }, () => uuidV7());

  const plans = await seedPlans(admin, tenantId, people, paths);
  const memberships = await seedMemberships(admin, tenantId, people, pools);
  const succession = await seedSuccession(admin, tenantId, positions);
  const successors = await seedSuccessors(admin, tenantId, people, succession, levels);

  await seedAssessments(admin, tenantId, people, succession, levels);

  const development = await seedDevelopment(admin, tenantId, people);

  await seedItems(admin, tenantId, development);
  await seedRecommendations(admin, tenantId, people, positions);

  return { paths, pools, levels, people, positions, plans, memberships, succession, successors };
};

const seedPaths = async (admin, tenantId) => {
  const paths = Array.from({ length: PATHS }, (_, index) => ({
    pathId: uuidV7(),
    code: `path-${String(index)}`,
    // A fifth archived, so `status` is a filter that actually excludes something.
    status: index === 0 ? 'archived' : index < 2 ? 'draft' : 'published',
  }));

  await insertAll(
    admin,
    'career_path',
    ['id', 'tenant_id', 'code', 'name', 'kind', 'status', 'effective_from'],
    paths.map((path) => [
      path.pathId,
      tenantId,
      path.code,
      JSON.stringify({ en: path.code, ar: path.code }),
      'management',
      path.status,
      '2026-01-01',
    ]),
  );

  await insertAll(
    admin,
    'career_stage',
    ['id', 'tenant_id', 'path_id', 'sequence', 'name', 'target_position_id'],
    paths.flatMap((path) =>
      Array.from({ length: STAGES_PER_PATH }, (_, index) => [
        uuidV7(),
        tenantId,
        path.pathId,
        index + 1,
        JSON.stringify({ en: `stage ${String(index)}`, ar: `stage ${String(index)}` }),
        uuidV7(),
      ]),
    ),
  );

  return paths;
};

const seedPools = async (admin, tenantId) => {
  const pools = Array.from({ length: POOLS }, (_, index) => ({
    talentPoolId: uuidV7(),
    code: `pool-${String(index)}`,
    status: index === 0 ? 'closed' : 'active',
  }));

  await insertAll(
    admin,
    'career_talent_pool',
    ['id', 'tenant_id', 'code', 'name', 'kind', 'status'],
    pools.map((pool) => [
      pool.talentPoolId,
      tenantId,
      pool.code,
      JSON.stringify({ en: pool.code, ar: pool.code }),
      'high_potential',
      pool.status,
    ]),
  );
  return pools;
};

const seedLevels = async (admin, tenantId) => {
  const levels = Array.from({ length: LEVELS }, (_, index) => ({
    readinessLevelId: uuidV7(),
    ordinal: index + 1,
  }));

  await insertAll(
    admin,
    'career_readiness_level',
    ['id', 'tenant_id', 'code', 'name', 'ordinal', 'active'],
    levels.map((level) => [
      level.readinessLevelId,
      tenantId,
      `level-${String(level.ordinal)}`,
      JSON.stringify({
        en: `level ${String(level.ordinal)}`,
        ar: `level ${String(level.ordinal)}`,
      }),
      level.ordinal,
      true,
    ]),
  );
  return levels;
};
