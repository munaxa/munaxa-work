import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { platformGrantFor } from './platform-grants.js';
import { WORK_PERMISSION_CATALOGUE, workPermissionCatalogue } from './work-permission-catalogue.js';

/**
 * The catalogue, and the artifact Platform's grant list is generated from.
 *
 * These are two derivations of one fact — the compiled constant assembles what each module
 * publishes, and `scripts/emit-permission-catalogue.mjs` reads the declarations from source. They
 * are allowed to exist separately because the script must run on a bare checkout with no install,
 * and they are pinned to each other here because two derivations that may disagree eventually will:
 * the day they do, a grant Platform issues names a permission Work no longer has, and the symptom
 * is a 403 with no explanation.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');

const emitted = (...args: readonly string[]): readonly string[] =>
  JSON.parse(
    execFileSync('node', ['scripts/emit-permission-catalogue.mjs', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    }),
  ) as readonly string[];

describe('the declared catalogue', () => {
  it('holds every permission Work declares', () => {
    expect(WORK_PERMISSION_CATALOGUE.size).toBe(285);
  });

  it('is sorted and free of duplicates when listed', () => {
    const listed = workPermissionCatalogue();

    expect(listed).toEqual([...listed].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('contains only Work-grammar names — no colon, no wildcard', () => {
    for (const permission of workPermissionCatalogue()) {
      expect(permission).not.toContain(':');
      expect(permission).not.toContain('*');
      expect(permission).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
    }
  });

  it('spans the eighteen modules', () => {
    const modules = new Set(workPermissionCatalogue().map((p) => p.split('.')[0]));

    expect(modules.size).toBe(18);
  });
});

describe('the generated artifact', () => {
  it('lists exactly the permissions the compiled catalogue holds', () => {
    expect(emitted('--work')).toEqual(workPermissionCatalogue());
  });

  it('emits the Platform grant form of each, in the same order', () => {
    expect(emitted()).toEqual(workPermissionCatalogue().map(platformGrantFor));
  });

  it('is deterministic across runs', () => {
    expect(emitted()).toEqual(emitted());
  });

  it('carries permission names and nothing else', () => {
    const raw = JSON.stringify(emitted());

    for (const forbidden of ['token', 'secret', 'password', 'tenant_id', 'BEGIN', 'key']) {
      expect(raw).not.toContain(forbidden);
    }
    expect(emitted().every((grant) => grant.startsWith('work:'))).toBe(true);
  });
});
