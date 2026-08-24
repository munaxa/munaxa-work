import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { UnitOfWork } from '@work/kernel';

import { assetsModule } from './assets-module.js';
import { inMemoryAssetsStores } from './in-memory-stores.js';
import { CUSTODY_STATES } from '../domain/assets-vocabulary.js';
import { ALL_CODE, IDENTIFIERS, SOURCE_ROOT, codeOf, sourceFiles } from './source-scan.fixture.js';

/**
 * The negative space: what this module deliberately does **not** contain.
 *
 * Every assertion here corresponds to something the Checkpoint 1 authorization excluded by name, or
 * to an architectural boundary a later checkpoint could cross by accident. They are tests rather
 * than prose because a promise in a comment survives a refactor and a test does not.
 *
 * The scans read the module's own source. Comments are stripped first: this file's neighbours explain
 * at length what they deliberately do not do — "there is no `JobPort`", "no Payroll adapter" — and a
 * scan that could not tell prose from code would force those explanations out of exactly the files
 * that most need them.
 */

const NEVER_EXECUTED: UnitOfWork = {
  // Typed rather than asserted: `UnitOfWork` has exactly one method, so a real implementation costs a
  // line and an `as never` would hide the day it grows a second.
  execute: () => Promise.reject(new Error('the module under test must not reach the database')),
};

const moduleUnderTest = () =>
  assetsModule({
    unitOfWork: NEVER_EXECUTED,
    stores: inMemoryAssetsStores(),
    employments: { exists: () => Promise.resolve(true) },
    clock: { now: () => new Date('2026-08-23T09:00:00Z') },
  });

describe('what Checkpoints 1 and 2 did not build', () => {
  /**
   * The exclusion list, as identifiers rather than prose.
   *
   * Matched against stripped code, so a comment explaining that transfer is a later capability does
   * not fail the test that transfer is not implemented.
   *
   * **`assetCustody`, `asset_custody` and `custodyStore` left this list because Checkpoint 2 was
   * authorized to build them, and for no other reason.** Everything else stayed, and the protection
   * those three gave is not lost — it is replaced by the assertions below that pin exactly what
   * custody *is*: two states, two commands, and none of the operations nobody approved.
   */
  it('implements no transfer, acknowledgement, acceptance, cancellation or correction', () => {
    for (const absent of [
      'CustodyTransfer',
      'transferCustody',
      'acknowledgeCustody',
      'acknowledgement',
      'acknowledgedOn',
      'acceptCustody',
      'cancelCustody',
      'correctCustody',
      'correctsCustodyId',
      'ClearanceItem',
      'clearance',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * Custody exists, and is exactly this shape.
   *
   * The positive half of the assertion above: an exclusion list that merely lost three entries would
   * be weaker than it was, so what replaced them states what the approved capability actually is.
   */
  it('implements custody as two states and no more', () => {
    const module = moduleUnderTest();
    const commands = (module.commands ?? []).map((handler) => handler.commandName);

    expect(commands).toContain('assets.issue-custody');
    expect(commands).toContain('assets.return-custody');
    expect(CUSTODY_STATES).toEqual(['open', 'returned']);

    for (const absent of [
      'issued',
      'accepted',
      'acknowledged',
      'cancelled',
      'transferred',
      'overdue',
    ]) {
      expect(CUSTODY_STATES as readonly string[]).not.toContain(absent);
    }
  });

  /**
   * No expected-return date, and therefore no reminder anything could hang off.
   *
   * Excluded by name because it is the column that leads somewhere this checkpoint must not go:
   * Platform scheduling and automatic reminders are both negative space.
   */
  it('records no expected return and schedules no reminder', () => {
    for (const absent of ['expectedReturn', 'expected_return', 'dueOn', 'overdue', 'reminder']) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  it('implements no incident, liability, waiver or deduction', () => {
    for (const absent of [
      'AssetIncident',
      'asset_incident',
      'liability',
      'waiver',
      'writeOff',
      'written_off',
      'deduction',
      'Deduction',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  it('implements no condition scale and no valuation of any kind', () => {
    for (const absent of [
      'conditionScale',
      'condition_scale',
      'conditionAtIssue',
      'valuationBasis',
      'valuation',
      'depreciation',
      'purchasePrice',
      'Money',
      'amount',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * **Names an employment, and never a person.**
   *
   * `employmentId` left the exclusion list because AD-001 requires custody to reference Employment —
   * and every *person*-shaped identifier stayed, along with the personal fields a directory would
   * accumulate. The replacement is stricter than the original in the direction that matters: it now
   * forbids a name, an email and a national identifier by name, which the old assertion never did.
   */
  it('names an employment, and never a person', () => {
    expect(IDENTIFIERS).toContain('employmentId');

    for (const absent of [
      'personId',
      'person_id',
      'custodianId',
      'holderId',
      'managerEmploymentId',
      'employeeName',
      'personName',
      'emailAddress',
      'nationalId',
      'userId',
      'membershipId',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * The current custodian is derived, and no second copy of it exists.
   *
   * This is the assertion that keeps ADR-0070 true as custody grows: the open custody row is the
   * answer, and a denormalized copy on `asset` would be a second one that goes stale.
   */
  it('holds no second copy of the current custodian', () => {
    for (const absent of [
      'currentEmployeeId',
      'current_employee_id',
      'currentCustodyId',
      'current_custody_id',
      'inCustody',
      'in_custody',
      'isIssued',
      'assigned',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });
});

describe('the cross-module boundary', () => {
  /**
   * Zero cross-module dependencies, asserted at the only two places one could appear: the package's
   * own imports, and its dependency type.
   */
  it('imports no other module’s package', () => {
    const imports = [...ALL_CODE.matchAll(/from '(@work\/[a-z-]+)/g)].map((match) => match[1]);

    expect([...new Set(imports)].sort()).toEqual(['@work/kernel', '@work/persistence']);
  });

  /**
   * **Exactly one port to another module, and it is the one Checkpoint 2 approved.**
   *
   * `EmploymentDirectoryPort` left the exclusion list because custody references Employment. The
   * replacement pins the count rather than merely removing the entry: one port, named, and every
   * other still absent — so a second cross-module dependency fails this test rather than passing it
   * quietly.
   */
  it('declares exactly one port to another module, and none of the others', () => {
    expect(IDENTIFIERS).toContain('EmploymentDirectoryPort');

    for (const absent of [
      'MembershipDirectoryPort',
      'DocumentReferencePort',
      'ApprovalPort',
      'StoragePort',
      'NotificationPort',
      'NotificationIntentPort',
      'JobPort',
      'ReportingLinePort',
      'runWithServiceGrant',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * The port learns one boolean, and the module has nowhere to put anything more.
   *
   * Asserted on the interface itself: a port that returned a view could grow into the workforce
   * directory an asset register must not become.
   */
  it('learns one boolean from Employment and nothing else', () => {
    const ports = readFileSync(join(SOURCE_ROOT, 'application', 'assets-ports.ts'), 'utf8');
    const declaration = ports.slice(ports.indexOf('interface EmploymentDirectoryPort'));

    expect(declaration.slice(0, declaration.indexOf('}'))).toContain(
      'exists(employmentId: string): Promise<boolean>;',
    );
    expect(IDENTIFIERS).not.toContain('EmploymentView');
    expect(IDENTIFIERS).not.toContain('EmploymentStatus');
  });

  /**
   * The module dispatches to nothing, and the one place a dispatcher appears is the Nest wrapper.
   *
   * `AssetsDispatcher` exists because a controller needs a constructor parameter Nest can resolve;
   * it forwards a caller's own request into the same pipeline every module uses. What would be a
   * cross-module dependency is a *handler* or an *adapter* holding a dispatcher and asking another
   * module a question — so the assertion is about where the type may appear, not whether it appears.
   */
  it('holds a dispatcher only in its own transport wrapper, never in a handler or an adapter', () => {
    const holders = sourceFiles(SOURCE_ROOT).filter((path) => /\bDispatcher\b/.test(codeOf(path)));

    expect(holders.map((path) => path.slice(SOURCE_ROOT.length + 1))).toEqual([
      join('api', 'assets-dispatcher.ts'),
    ]);
  });

  it('sends no command and asks no query outside itself', () => {
    const commands = [...ALL_CODE.matchAll(/commandName: '([a-z.-]+)'/g)].map((match) => match[1]);
    const queries = [...ALL_CODE.matchAll(/queryName: '([a-z.-]+)'/g)].map((match) => match[1]);

    for (const name of [...commands, ...queries]) {
      expect(name?.startsWith('assets.')).toBe(true);
    }
  });

  it('touches Payroll, Workflow, Documents, Identity, Platform and the rest not at all', () => {
    for (const absent of [
      'payroll.',
      'workflow.',
      'documents.',
      'identity.',
      'platform.',
      'letters.',
      'relations.',
      'onboarding.',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * Employment is *asked*, never written to and never enumerated.
   *
   * The module names no Employment query at all — the adapter that does lives at the composition
   * root, which is the boundary. What must never appear here is a command to Employment, or a read
   * that returns more than the predicate.
   */
  it('sends Employment no command and reads no employment record', () => {
    for (const absent of [
      'employment.read-employment',
      'employment.search',
      'employment.export-workforce',
      'employment.read-history',
    ]) {
      expect(ALL_CODE).not.toContain(absent);
    }
  });
});
