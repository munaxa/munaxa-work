import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assetsModule } from './assets-module.js';
import { inMemoryAssetsStores } from './in-memory-stores.js';
import { ALL_ASSETS_PERMISSIONS } from './assets-permissions.js';

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

/**
 * The same code with its string literals removed as well.
 *
 * Used by the scans that ask whether a *concept* is implemented. A Swagger description saying "no
 * valuation basis: neither is built" is prose that happens to live in a string, and a scan that could
 * not tell it from an identifier would force the API to stop documenting its own boundaries — which
 * is the same mistake as scanning comments, one layer down. The scans that read command and query
 * *names* deliberately use `ALL_CODE`, because there the string literal is the thing under test.
 */
const IDENTIFIERS = ALL_CODE.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");

/** The layers a caller's request passes through, where a tenant or an actor could be accepted. */
const CALLER_FACING_CODE = sourceFiles(SOURCE_ROOT)
  .filter((path) => path.includes('/application/') || path.includes('/api/'))
  .map(codeOf)
  .join('\n');

const moduleUnderTest = () =>
  assetsModule({
    unitOfWork: { execute: () => Promise.reject(new Error('not called')) } as never,
    stores: inMemoryAssetsStores(),
  });

describe('what Checkpoint 1 did not build', () => {
  /**
   * The exclusion list, as identifiers rather than prose.
   *
   * Matched against stripped code, so a comment explaining that custody is a later checkpoint does
   * not fail the test that custody is not implemented.
   */
  it('implements no custody, in any form', () => {
    for (const absent of [
      'CustodyAssignment',
      'CustodyTransfer',
      'assetCustody',
      'asset_custody',
      'custodyStore',
      'issueAsset',
      'returnAsset',
      'transferCustody',
      'acknowledgeCustody',
      'ClearanceItem',
      'clearance',
    ]) {
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

  it('names no person and no employment', () => {
    for (const absent of [
      'employmentId',
      'employment_id',
      'personId',
      'person_id',
      'custodianId',
      'holderId',
      'managerEmploymentId',
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

  it('declares no port to any other module, and no port at all beyond persistence', () => {
    for (const absent of [
      'EmploymentDirectoryPort',
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

  it('touches Payroll, Workflow, Documents, Identity, Employment and Platform not at all', () => {
    for (const absent of [
      'payroll.',
      'workflow.',
      'documents.',
      'identity.',
      'employment.',
      'platform.',
      'letters.',
      'relations.',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });
});

describe('what nothing here does automatically', () => {
  /**
   * No event is raised and none is subscribed to.
   *
   * The specification names eight domain events, every one of which describes custody. Dispatch here
   * is at-most-once with no outbox (ADR-0053/0064), and none of the eight has a consumer — raising
   * one would be a promise about delivery to nobody.
   */
  it('raises no domain event and subscribes to none', () => {
    const module = moduleUnderTest();

    expect(module.eventHandlers ?? []).toHaveLength(0);

    for (const absent of [
      'AssetIssued',
      'CustodyAcknowledged',
      'AssetReturned',
      'CustodyTransferred',
      'AssetLost',
      'AssetDamaged',
      'CustodyOutstanding',
      'DeductionAuthorized',
      'eventHandlers',
      'publish(',
      'emit(',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  it('schedules nothing and has no clock to schedule against', () => {
    for (const absent of ['setTimeout', 'setInterval', 'cron', 'schedule', 'Clock']) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * No layer a caller's request reaches can accept a tenant or an actor.
   *
   * Scoped to `application` and `api` deliberately, and that scope is the assertion rather than a
   * convenience: infrastructure *must* write `tenant_id` into a row, and it takes the value from
   * `transaction.tenantId` — the execution context — which is exactly the design. What must never
   * exist is a command, a query or a DTO with a field a caller could fill in.
   */
  it('never lets a caller name a tenant or an actor', () => {
    for (const absent of [
      'tenantId',
      'tenant_id',
      'actor',
      'createdBy',
      'registeredBy',
      'currentActor',
    ]) {
      expect(CALLER_FACING_CODE).not.toContain(absent);
    }
  });

  it('publishes no route verb that edits or deletes in place', () => {
    for (const absent of ['@Put(', '@Patch(', '@Delete(']) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  it('holds no soft-delete or hard-delete path for an asset', () => {
    for (const absent of ['softDelete', 'deleteRow', 'remove(', 'delete from']) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });
});

describe('the module’s declared shape', () => {
  it('publishes five commands and three queries, and nothing else', () => {
    const module = moduleUnderTest();

    expect((module.commands ?? []).map((handler) => handler.commandName).sort()).toEqual([
      'assets.amend-asset',
      'assets.amend-category',
      'assets.change-asset-status',
      'assets.define-category',
      'assets.register-asset',
    ]);
    expect((module.queries ?? []).map((handler) => handler.queryName).sort()).toEqual([
      'assets.categories',
      'assets.read-asset',
      'assets.search-assets',
    ]);
  });

  it('declares four permissions and is named assets', () => {
    const module = moduleUnderTest();

    expect(module.name).toBe('assets');
    expect(module.permissions).toHaveLength(4);
    expect(ALL_ASSETS_PERMISSIONS).toHaveLength(4);
  });

  /**
   * No country-pack claim anywhere.
   *
   * `relation_violation_category` carries a provenance discriminator because a disciplinary
   * catalogue will one day be supplied by statute. An asset catalogue will not: no jurisdiction
   * prescribes what a company may call a laptop, and a `source` column here would be inviting an
   * invented legal boundary.
   */
  it('claims no statutory provenance and invents no country rule', () => {
    for (const absent of ['countryPack', 'country_pack', 'jurisdiction', 'statutory']) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });
});
