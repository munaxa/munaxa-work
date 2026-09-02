#!/usr/bin/env node
/**
 * Emits Munaxa Work's permission catalogue, in the form Platform records a grant (ADR-0076).
 *
 * **What it is for.** No Platform wildcard confers a Work permission, so a Platform role granting
 * broad Work access has to enumerate its grants. Maintaining that list by hand is how it silently
 * drifts from what Work actually declares — a permission added here and forgotten there is
 * ungrantable, and the symptom is a 403 nobody can explain. This makes the list a build output of
 * the declarations themselves.
 *
 * **Why it reads the source rather than importing it.** The catalogue constant lives in TypeScript
 * that has to be compiled, and a generator that needs a build is a generator that stops working the
 * day the build breaks. Reading the declarations directly is what every other gate in `scripts/`
 * does, and it keeps this runnable on a bare checkout with no install and no registry access.
 * `work-permission-catalogue.spec.ts` asserts this output and the compiled catalogue agree, so the
 * two cannot drift apart without a test failing.
 *
 * **What it must never contain**: a credential, a tenant, a user, a key. It emits permission names,
 * which are the same strings an administrator types into a role, and nothing else.
 *
 * Usage:
 *   node scripts/emit-permission-catalogue.mjs            # JSON to stdout
 *   node scripts/emit-permission-catalogue.mjs --work     # Work's own names instead
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODULES = join(ROOT, 'packages/modules');

/** The namespace reserved for Munaxa Work in Platform's grant space. Mirrors `platform-grants.ts`. */
const NAMESPACE = 'work:';

/** φ, exactly as ADR-0076 states it. */
const platformGrantFor = (permission) => `${NAMESPACE}${permission.replaceAll('.', ':')}`;

/**
 * A declared permission is a string literal in a module's permission object. The object is the
 * declaration — `Object.values` of it is what the module publishes as its own list — so reading its
 * literals reads the same set the application does.
 */
const LITERAL = /'([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)'/g;

const declaredPermissions = () => {
  const permissions = new Set();

  for (const module of readdirSync(MODULES)) {
    const application = join(MODULES, module, 'src/application');
    let entries;

    try {
      entries = readdirSync(application);
    } catch {
      continue;
    }
    for (const file of entries.filter((name) => name.endsWith('permissions.ts'))) {
      const source = readFileSync(join(application, file), 'utf8');

      for (const [, permission] of source.matchAll(LITERAL)) permissions.add(permission);
    }
  }
  return [...permissions].sort();
};

const work = declaredPermissions();
const emitWorkNames = process.argv.includes('--work');

process.stdout.write(
  `${JSON.stringify(emitWorkNames ? work : work.map(platformGrantFor), undefined, 2)}\n`,
);
