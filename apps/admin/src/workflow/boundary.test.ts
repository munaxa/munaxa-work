import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * What the approvals screen is allowed to be built out of.
 *
 * Every other suite here asserts what the screen renders. This one asserts what it is **made of**,
 * because the two failures look identical from the outside: a page that reached a repository
 * directly would render exactly the same markup as one that went through the API, right up to the
 * day it read a row row-level security would have hidden.
 *
 * The rule is one sentence. **Admin talks to the API and to nothing else.** Not to Prisma, not to a
 * store, not to a unit of work, not to an application handler, not to a domain aggregate, and not to
 * another module's contracts — the Recruitment seam that carries a decision lives inside the
 * approver's own request in the API, and this app holds no route to it and no reason to.
 *
 * Asserted over the source rather than over the imports resolved at run time, so a type-only import
 * of something forbidden fails here too: a type from a repository is a repository's shape leaking
 * into a screen, and the screen would compile against it long enough for somebody to use the value.
 */

const HERE = import.meta.dirname;

/**
 * A file with its comments removed.
 *
 * The assertions below are about **code**, and every one of these files explains the boundary it
 * keeps — `api.ts` names `workforceUserId` in the sentence saying it never sends one, and describes
 * the path a value takes through a repository to PostgreSQL. Searching the prose would fail on the
 * very paragraphs that make the refusal legible, which would force the screen to stop explaining
 * itself. A type-only import survives the strip, so an import of something forbidden still fails.
 */
const codeOf = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every production file of the workspace. Tests and fixtures are not shipped and are excluded. */
const production = (): readonly (readonly [string, string])[] =>
  readdirSync(HERE)
    .filter(
      (file) => /\.tsx?$/.test(file) && !file.includes('.test.') && !file.includes('.fixture'),
    )
    .map((file) => [file, codeOf(readFileSync(join(HERE, file), 'utf8'))] as const);

/** The page component itself, which is the one file outside this directory. */
const page = (): string =>
  codeOf(readFileSync(join(HERE, '..', 'app', 'workflow', 'page.tsx'), 'utf8'));

describe('the approvals screen reaches the API and nothing else', () => {
  it('covers every production file of the workspace, so nothing is checked by omission', () => {
    const files = production().map(([file]) => file);

    // The listing is read rather than written down, so a file added tomorrow is checked tomorrow.
    expect(files).toContain('api.ts');
    expect(files).toContain('groups.tsx');
    expect(files).toContain('branches.tsx');
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('names no persistence, no handler and no domain object anywhere', () => {
    for (const [file, source] of [...production(), ['page.tsx', page()] as const]) {
      for (const forbidden of [
        'PrismaClient',
        '@prisma',
        'UnitOfWork',
        'Repository',
        'repository',
        'ApprovalPort',
        'BusinessDecisionPort',
        'Dispatcher',
        'use-case',
        'workflow-stores',
        'in-memory',
        'select ',
        'insert into',
        'update ',
      ]) {
        expect([file, forbidden, source.includes(forbidden)]).toEqual([file, forbidden, false]);
      }
    }
  });

  /**
   * Only the module's published contracts, and only this module's.
   *
   * `@work/workflow/contracts` is the whole of what this screen may know about Workflow: its
   * handlers, its stores, its tables and its aggregates are private. And no other business module
   * appears at all — an approval about a `recruitment.requisition` shows the subject type Workflow
   * stored, and resolving it would be this screen doing Recruitment's reading with Workflow's
   * permission.
   */
  it('imports the published contracts of this module, and no other module at all', () => {
    for (const [file, source] of [...production(), ['page.tsx', page()] as const]) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');

      for (const specifier of imports) {
        const allowed =
          specifier.startsWith('.') ||
          specifier === 'react' ||
          specifier === '@munaxa/ui' ||
          specifier === '@work/config' ||
          specifier === '@work/workflow/contracts' ||
          specifier.startsWith('@work/workflow/locales/');

        expect([file, specifier, allowed]).toEqual([file, specifier, true]);
      }
    }
  });

  it('is server-rendered throughout, with no client directive and no browser state', () => {
    for (const [file, source] of [...production(), ['page.tsx', page()] as const]) {
      for (const client of [
        'use client',
        'useState',
        'useEffect',
        'useRouter',
        'onClick',
        'window.',
      ]) {
        expect([file, client, source.includes(client)]).toEqual([file, client, false]);
      }
    }
  });

  /**
   * The queue carries a page and a size, and there is no identity anywhere in the file that reads
   * it.
   *
   * The `api` suite proves this over the requests actually made. This proves it over the source, so
   * a parameter added behind a condition — one a stubbed run might not take — fails as well.
   */
  it('has no identity parameter in the file that makes the requests', () => {
    const source = codeOf(readFileSync(join(HERE, 'api.ts'), 'utf8'));

    for (const identity of [
      'membershipId=',
      'workforceUserId',
      'platformUserId',
      'approverMembershipId',
      'actorId',
      'onBehalfOf',
      'delegate=',
      'me=true',
      'self=',
      'tenantId',
      'tenant=',
    ]) {
      expect([identity, source.includes(identity)]).toEqual([identity, false]);
    }
  });

  /** Every collection read is bounded, and the bound is written once. */
  it('sends a page and a size on every listing it asks for', () => {
    const source = codeOf(readFileSync(join(HERE, 'api.ts'), 'utf8'));
    const listings = [...source.matchAll(/read<Page<[^>]+>>\(`([^`]+)`\)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(listings.length).toBeGreaterThanOrEqual(5);
    for (const listing of listings) {
      expect([listing, listing.includes('${PAGE}')]).toEqual([listing, true]);
    }
  });
});
