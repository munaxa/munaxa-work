import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { UnitOfWork } from '@work/kernel';

import { assetsModule } from './assets-module.js';
import { inMemoryAssetsStores } from './in-memory-stores.js';
import { ALL_ASSETS_PERMISSIONS } from './assets-permissions.js';

/**
 * The module's declared shape, and what it never does on its own.
 *
 * Split from `assets-boundaries.test.ts` when the two together passed the 400-line file budget. The
 * scanning helpers are duplicated rather than shared because a test's fixture reaching across files is
 * how one suite comes to depend on another's setup — and both copies are four lines.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
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

/** The same code with its string literals removed — see the note in `assets-boundaries.test.ts`. */
const IDENTIFIERS = ALL_CODE.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");

/** The layers a caller's request passes through, where a tenant or an actor could be accepted. */
const CALLER_FACING_CODE = sourceFiles(SOURCE_ROOT)
  .filter((path) => path.includes('/application/') || path.includes('/api/'))
  .map(codeOf)
  .join('\n');

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

  /**
   * A clock exists, and it is only ever asked what day it is.
   *
   * `Clock` left the exclusion list because custody records days and a caller must not be able to
   * date a handover into the future. The replacement is exact rather than absent: the clock is read,
   * never waited on, and nothing here schedules anything — which is the property the original
   * assertion was actually protecting.
   */
  it('reads the clock but schedules nothing against it', () => {
    expect(IDENTIFIERS).toContain('Clock');

    for (const absent of [
      'setTimeout',
      'setInterval',
      'cron',
      'schedule',
      'JobPort',
      'runAt',
      'nextRun',
    ]) {
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
  it('publishes seven commands and five queries, and nothing else', () => {
    const module = moduleUnderTest();

    expect((module.commands ?? []).map((handler) => handler.commandName).sort()).toEqual([
      'assets.amend-asset',
      'assets.amend-category',
      'assets.change-asset-status',
      'assets.define-category',
      'assets.issue-custody',
      'assets.register-asset',
      'assets.return-custody',
    ]);
    expect((module.queries ?? []).map((handler) => handler.queryName).sort()).toEqual([
      'assets.asset-custody',
      'assets.categories',
      'assets.employment-custody',
      'assets.read-asset',
      'assets.search-assets',
    ]);
  });

  it('declares seven permissions and is named assets', () => {
    const module = moduleUnderTest();

    expect(module.name).toBe('assets');
    expect(module.permissions).toHaveLength(7);
    expect(ALL_ASSETS_PERMISSIONS).toHaveLength(7);
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
