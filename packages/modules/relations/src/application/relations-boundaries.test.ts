import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { relationsModule } from './relations-module.js';
import { inMemoryRelationsStores } from './in-memory-stores.js';
import { ALL_RELATIONS_PERMISSIONS } from './relations-permissions.js';

/**
 * The negative space: what this module deliberately does **not** contain.
 *
 * Every assertion here corresponds to something the Checkpoint 1 approval excluded by name, or to an
 * architectural boundary a later checkpoint could cross by accident. They are tests rather than
 * prose because a promise in a comment survives a refactor and a test does not.
 *
 * The scans read the module's own source. Comments are stripped first: this file's neighbours
 * explain at length what they deliberately do not do — "there is no `JobPort`", "no scheduler" — and
 * a scan that could not tell prose from code would force those explanations out of exactly the files
 * that most need them.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    // Test doubles, suites and the database fixture describe absences in order to assert them, and
    // the fixture legitimately constructs the event dispatcher `PostgresUnitOfWork` requires.
    // Scanning them would make this file fail on its own supporting cast rather than on the module.
    if (
      entry.name.includes('.test.') ||
      entry.name.includes('test-harness') ||
      entry.name.includes('.fixture.')
    ) {
      return [];
    }
    return [path];
  });

const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const ALL_CODE = sourceFiles(SOURCE_ROOT).map(codeOf).join('\n');

const moduleUnderTest = () =>
  relationsModule({
    unitOfWork: { execute: () => Promise.reject(new Error('not called')) } as never,
    stores: inMemoryRelationsStores(),
    employments: { exists: () => Promise.resolve(true) },
    memberships: { canAct: () => Promise.resolve(true) },
    clock: { now: () => new Date() },
  });

describe('what Checkpoints 1 and 2 did not build', () => {
  /**
   * The exclusion list, as identifiers rather than prose.
   *
   * Matched against stripped code, so a comment explaining that grievances are a later checkpoint
   * does not fail the test that grievances are not implemented.
   *
   * **`Investigation` left this list because Checkpoint 2 was approved to build it**, and for no
   * other reason. Everything else on it stayed. The protection an entry gives is not lost when the
   * capability is approved — it is replaced by the tests that assert how the capability actually
   * behaves: the transition rules, the immutability of a concluded inquiry, and the audit of every
   * read of one. An entry may only leave here with an approval behind it.
   */
  it.each([
    'DisciplinaryAction',
    'Warning',
    'Grievance',
    'Appeal',
    'Penalty',
    'Hearing',
    'Evidence',
    'Attachment',
    'Termination',
  ])('holds no %s type', (absent) => {
    expect([absent, ALL_CODE.includes(absent)]).toStrictEqual([absent, false]);
  });

  /** No storage adapter, and no `StoragePort` — evidence attachment is a later decision. */
  it.each(['StoragePort', 'signedUrl', 'S3', 'bucket', 'upload', 'download'])(
    'reaches no storage: %s',
    (forbidden) => {
      expect([forbidden, ALL_CODE.toLowerCase().includes(forbidden.toLowerCase())]).toStrictEqual([
        forbidden,
        false,
      ]);
    },
  );

  /**
   * No jurisdiction, no statute, no legal limit.
   *
   * AD-002 says nothing is hardcoded and the country pack is unbuilt. A country code or a
   * jurisdiction name appearing in this module would be invented legal content — the one thing
   * D-5.2-06 refused outright.
   */
  it.each([
    'Jordan',
    'jordan',
    'Saudi',
    'GOSI',
    'labour law',
    'labor law',
    'statutoryLimit',
    'maxPenalty',
    'legallyPermitted',
  ])('invents no legal content: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** Expiry stays derived. No column, no flag, no sweep (D-5.2-09). */
  it.each(['expiredAt', 'expired_at', 'isExpired', 'markExpired', 'sweep'])(
    'persists no derived temporal state: %s',
    (forbidden) => {
      expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
    },
  );
});

describe('the boundaries this module keeps', () => {
  /**
   * Employment, never Person (AD-001).
   *
   * `personId`, a People port or a People query here would mean this module holding an identity it
   * does not own — and a disciplinary module that knew people's names would be a directory of
   * accused people.
   */
  it.each(['personId', 'person_id', 'PersonPort', 'people.read-person', 'PeopleDirectory'])(
    'never reaches People: %s',
    (forbidden) => {
      expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
    },
  );

  /** Manager resolution is Workflow 16C's. Duplicating it would give two answers on one contract. */
  it.each(['managerEmploymentId', 'reportingLine', 'resolveManager'])(
    'never duplicates manager resolution: %s',
    (forbidden) => {
      expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
    },
  );

  /**
   * Tenancy never arrives as a business field.
   *
   * A command or a DTO carrying `tenantId` would let a caller file a disciplinary record into
   * another organisation. It comes from the execution context, and RLS filters beneath it.
   */
  it('accepts no tenant identifier from a caller', () => {
    const commandsAndDtos = sourceFiles(SOURCE_ROOT)
      .filter(
        (path) => path.includes('use-case') || path.includes('.dto.') || path.includes('queries'),
      )
      .map(codeOf)
      .join('\n');

    expect(commandsAndDtos).not.toContain('tenantId');
  });

  /**
   * The reporter is never a field a caller can set.
   *
   * Asserted on the DTOs, which are the only shapes a request can take.
   */
  it.each(['reportedBy', 'reporter', 'actor', 'recordedAt', 'recordedOn'])(
    'accepts no %s from a caller',
    (forbidden) => {
      const dtos = codeOf(join(SOURCE_ROOT, 'api', 'relations.dto.ts'));

      expect([forbidden, dtos.includes(forbidden)]).toStrictEqual([forbidden, false]);
    },
  );

  /**
   * The module publishes no tenant-wide enumeration of violations.
   *
   * The only collection read takes an employment. A query returning every disciplinary matter in an
   * organisation is a watchlist, and nobody approved one.
   */
  it('publishes no read of violations that is not scoped to one employment', () => {
    const module = moduleUnderTest();
    const queries = (module.queries ?? []).map((handler) => handler.queryName);

    expect(queries).toStrictEqual([
      'relations.categories',
      'relations.read-violation',
      'relations.violations',
      'relations.read-investigation',
      'relations.investigations',
      'relations.case-history',
    ]);

    const listing = codeOf(join(SOURCE_ROOT, 'application', 'relations-queries.ts'));

    // The bounded read names the employment it is for, in the handler and in the store call.
    expect(listing).toContain('employmentId');

    // Every collection read Checkpoint 2 added is scoped to one violation, exactly as the violation
    // list is scoped to one employment. Nothing published here lists a tenant's cases at large.
    expect(listing).toContain('violationId');
  });

  /**
   * Five commands, and **still not one that changes or removes a recorded violation**.
   *
   * That is the assertion this test has always made, and Checkpoint 2 does not weaken it: the two
   * new commands write an investigation and a case event, and the violation row they concern is
   * never updated. `relation_violation` stays immutable at the database exactly as D-5.2-03 left it.
   *
   * `correct-investigation` is absent for a different reason — it was not in the approved scope, and
   * inventing it here would be the scope expansion the checkpoint forbids.
   */
  it('publishes no command that could change or remove a recorded violation', () => {
    const module = moduleUnderTest();
    const commands = (module.commands ?? []).map((handler) => handler.commandName);

    expect(commands).toStrictEqual([
      'relations.define-category',
      'relations.amend-category',
      'relations.record-violation',
      'relations.open-investigation',
      'relations.conclude-investigation',
    ]);
    for (const forbidden of [
      'amend-violation',
      'delete-violation',
      'correct-violation',
      'correct-investigation',
      'delete-investigation',
      'transition-case',
      'set-case-state',
    ]) {
      expect(commands).not.toContain(`relations.${forbidden}`);
    }
  });

  /**
   * The store interface itself offers no mutation of a violation or an access event.
   *
   * A stronger statement than "no command exists": there is no *method* a future command could
   * reach for without changing the port first, which makes crossing this boundary a deliberate act.
   */
  it('offers no update or remove on the violation and access stores', () => {
    const ports = codeOf(join(SOURCE_ROOT, 'application', 'relations-ports.ts'));
    const violationStore = ports.slice(
      ports.indexOf('interface ViolationStore'),
      ports.indexOf('interface AccessEventStore'),
    );

    expect(violationStore).toContain('insert(');
    expect(violationStore).not.toContain('update(');
    expect(violationStore).not.toContain('remove(');
  });

  it('registers exactly four permissions and one navigation entry', () => {
    const module = moduleUnderTest();

    expect(module.permissions).toEqual(ALL_RELATIONS_PERMISSIONS);
    expect(module.permissions).toHaveLength(4);
    expect(module.navigation).toHaveLength(1);
    // Behind the record permission, not the catalogue one: somebody who may only maintain the
    // policy has no business finding a link to the case register.
    expect(module.navigation?.[0]?.permission).toBe('relations.violation.read');
  });

  /**
   * Nothing raises a domain event and nothing subscribes to one.
   *
   * **Asserted structurally rather than by name**, and the reason is a real collision this test
   * found: the specification lists a `ViolationRecorded` *event*, and the command's *result* type is
   * called `ViolationRecorded` too — because the repository's convention for a result is
   * `<Thing><PastParticiple>`, exactly as Documents names `DocumentTypeDefined`. A string scan
   * cannot tell the two apart, and renaming the result to dodge the scan would break the convention
   * to please a test.
   *
   * So the boundary is asserted where it actually lives: the module registers no event handlers, and
   * no file imports or calls the event machinery. `ViolationRecorded` the event arrives when a
   * consumer does — the dispatch is at-most-once with no outbox (ADR-0053/0064), and an event nobody
   * consumes is a promise about delivery to nobody.
   */
  it('registers no event handler and reaches no event machinery', () => {
    expect(moduleUnderTest().eventHandlers).toBeUndefined();

    for (const forbidden of [
      'raise(',
      'subscribe(',
      'DomainEvent',
      'EventDispatcher',
      'eventHandlers',
    ]) {
      expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
    }
  });

  /** And the result type is a result, not an event: it carries an identifier and nothing else. */
  it('returns an identifier from recording, not an event payload', () => {
    const useCase = codeOf(join(SOURCE_ROOT, 'application', 'violation.use-case.ts'));
    const result = useCase.slice(
      useCase.indexOf('interface ViolationRecorded'),
      useCase.indexOf('export const recordViolationHandler'),
    );

    expect(result).toContain('violationId');
    expect(result).not.toContain('occurredAt');
    expect(result).not.toContain('employmentId');
  });
});
