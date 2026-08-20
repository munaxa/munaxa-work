import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';

import type { TenantMembershipView } from '../contracts/views.js';
import { IdentityPermissions } from './identity-permissions.js';
import {
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  type Harness,
} from './identity-test-harness.js';

/**
 * Who holds one employment — the single capability Phase 16C authorized on this completed module
 * (D-16C-04), and the boundaries that keep it a point query rather than a directory.
 *
 * **The question is deliberately small.** A caller hands over one employment identifier it already
 * holds and gets back the memberships of this tenant that are linked to it and may act. What it
 * cannot ask is "who works here", "who holds role X", "who is in this department" or "give me the
 * next page" — there is no parameter for any of them, and their absence is the authorization rather
 * than a convention.
 *
 * **Identity does not know what a manager is, and this file asserts that too.** The reporting line
 * is Employment's table and Employment already publishes the manager in force on a date. What was
 * missing was the last link — employment back to the person who may sign — and that is all this
 * query supplies. Whoever composes the two is doing so with its own approval; nothing here
 * traverses, chains, or takes a depth.
 *
 * **Two predicates, and they mean different things.** A *linked* employment link says the job is
 * still theirs. An *active* membership says they may act at all. A suspended member still holds
 * their link, and returning them would tell a consumer somebody could sign when they could not —
 * which is the exact distinction a consumer needs in order to tell "there is nobody to ask" from
 * "there is no such job".
 */

const APPLICATION = join(process.cwd(), 'src', 'application');
const QUERY = 'identity.active-memberships-for-employment';

const EMPLOYMENT = '01930000-0000-7000-8000-0000000000f1';
const OTHER_EMPLOYMENT = '01930000-0000-7000-8000-0000000000f2';

const holdersOf = (harness: Harness, employmentId: string): Promise<readonly unknown[]> =>
  asTenant(TENANT_A, async () => {
    const found = await ask<readonly TenantMembershipView[]>(harness, {
      queryName: QUERY,
      employmentId,
    });

    return assertSucceeded(found);
  });

/** A member of the tenant, holding one employment, built through the real commands. */
const memberHolding = async (
  harness: Harness,
  employmentId: string,
  platformUserId: string,
): Promise<{ readonly membershipId: string; readonly linkId: string }> =>
  asTenant(TENANT_A, async () => {
    const admitted = assertSucceeded(
      await send<{ membershipId: string }>(harness, {
        commandName: 'identity.admit-member',
        platformUserId,
      }),
    );
    const linked = assertSucceeded(
      await send<{ linkId: string }>(harness, {
        commandName: 'identity.link-employment',
        membershipId: admitted.membershipId,
        employmentId,
        isPrimary: true,
      }),
    );

    return { membershipId: admitted.membershipId, linkId: linked.linkId };
  });

describe('the memberships that hold one employment', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor(TENANT_A);
  });

  it('returns the member who holds it', async () => {
    const held = await memberHolding(harness, EMPLOYMENT, 'platform-sara');
    const found = await holdersOf(harness, EMPLOYMENT);

    expect(found).toHaveLength(1);
    expect((found[0] as TenantMembershipView).id).toBe(held.membershipId);
    expect((found[0] as TenantMembershipView).status).toBe('active');
  });

  it('returns nothing for an employment nobody holds', async () => {
    await memberHolding(harness, EMPLOYMENT, 'platform-sara');

    expect(await holdersOf(harness, OTHER_EMPLOYMENT)).toStrictEqual([]);
  });

  /**
   * Empty is a **real** answer and not the same one as "no such job".
   *
   * Identity is not asked whether the employment exists — that is Employment's fact — so a consumer
   * that gets nothing here learns there is nobody who may sign for it, which is a different sentence
   * from "there is no such employment" and leads somewhere different.
   */
  it('returns nothing for an employment identifier that means nothing here', async () => {
    expect(await holdersOf(harness, '01930000-0000-7000-8000-0000000000ff')).toStrictEqual([]);
  });

  it('stops returning somebody once their link is unlinked', async () => {
    const held = await memberHolding(harness, EMPLOYMENT, 'platform-sara');

    expect(await holdersOf(harness, EMPLOYMENT)).toHaveLength(1);

    await asTenant(TENANT_A, async () =>
      assertSucceeded(
        await send(harness, {
          commandName: 'identity.unlink-employment',
          linkId: held.linkId,
          reason: 'moved to another job',
          expectedVersion: 1,
        }),
      ),
    );

    expect(await holdersOf(harness, EMPLOYMENT)).toStrictEqual([]);
  });

  /**
   * The predicate that matters most, and the one a join would be easiest to write without.
   *
   * A member whose membership ended still has their employment link — the two have different
   * lifetimes and that is why they are two tables. Returning them here would tell a consumer
   * somebody could sign for this job when they cannot sign for anything.
   */
  it('excludes a member whose membership is no longer active, link and all', async () => {
    const held = await memberHolding(harness, EMPLOYMENT, 'platform-sara');

    await asTenant(TENANT_A, async () =>
      assertSucceeded(
        await send(harness, {
          commandName: 'identity.change-membership',
          membershipId: held.membershipId,
          transition: 'end',
          reason: 'left the organization',
          expectedVersion: 1,
        }),
      ),
    );

    const links = await asTenant(TENANT_A, () =>
      harness.work.execute((transaction) =>
        harness.stores.employmentLinks.forMembership(transaction, held.membershipId),
      ),
    );

    // The link is still there — this is not a cascade — and the person is still not returned.
    expect(links.length).toBeGreaterThan(0);
    expect(await holdersOf(harness, EMPLOYMENT)).toStrictEqual([]);
  });

  /**
   * Two holders come back as two, in a stable order, and Identity picks neither.
   *
   * `employment_link` is unique per `(membership, employment)` pair, so nothing prevents one job
   * being linked to two memberships. Collapsing them to the first here would be a routing rule
   * invented inside a read by whoever wrote the `limit 1` — so both are returned and the choosing
   * is left to a caller with approval to choose.
   */
  it('returns every holder, in a stable order, and chooses none of them', async () => {
    const first = await memberHolding(harness, EMPLOYMENT, 'platform-sara');
    const second = await memberHolding(harness, EMPLOYMENT, 'platform-omar');
    const found = (await holdersOf(harness, EMPLOYMENT)) as readonly TenantMembershipView[];

    expect(found.map((row) => row.id)).toStrictEqual(
      [first.membershipId, second.membershipId].sort((left, right) => left.localeCompare(right)),
    );
    // And asking twice gives the same answer in the same order.
    expect((await holdersOf(harness, EMPLOYMENT)) as readonly TenantMembershipView[]).toStrictEqual(
      found,
    );
  });

  it('is guarded by the employment-link read permission and by nothing broader', async () => {
    const restricted = harnessFor(TENANT_A, [
      IdentityPermissions.employmentLinkRead,
      IdentityPermissions.employmentLinkManage,
      IdentityPermissions.membershipManage,
    ]);

    await memberHolding(restricted, EMPLOYMENT, 'platform-sara');
    expect(await holdersOf(restricted, EMPLOYMENT)).toHaveLength(1);
  });

  it('refuses a caller holding every other Identity permission', async () => {
    const granted = Object.values(IdentityPermissions).filter(
      (permission) => permission !== IdentityPermissions.employmentLinkRead,
    );
    const without = harnessFor(TENANT_A, granted);

    await memberHolding(without, EMPLOYMENT, 'platform-sara');

    const refused = await asTenant(TENANT_A, () =>
      ask(without, { queryName: QUERY, employmentId: EMPLOYMENT }),
    );

    expect(refused.ok).toBe(false);
  });
});

/**
 * What this query is not, asserted against the source rather than argued in prose.
 *
 * The negative space is the authorization. D-16C-04 permitted one reverse lookup *because* it is a
 * point query, so the words that would announce a directory, a chain or a scheduler are checked for
 * absence — with comments and string literals stripped, since this module documents what it refuses
 * to build.
 */
describe('what Phase 16C did not add to Identity', () => {
  const codeOf = (file: string): string =>
    readFileSync(join(APPLICATION, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  it('adds no directory, no chain and nothing that runs on its own', () => {
    const code = ['identity-queries.ts', 'identity-ports.ts', 'identity-module.ts']
      .map((file) => codeOf(file))
      .join('\n');

    for (const forbidden of [
      'RoleDirectory',
      'GroupDirectory',
      'ManagerDirectory',
      'OrganizationChart',
      'managerOf',
      'reportingLine',
      'reportsTo',
      'JobPort',
      'scheduler',
      'cron',
      'setTimeout',
      'setInterval',
      'outbox',
      'notify',
      'escalat',
      'businessDay',
      'recursive',
      'WITH RECURSIVE',
    ]) {
      expect([forbidden, new RegExp(forbidden, 'i').test(code)]).toStrictEqual([forbidden, false]);
    }
  });

  /** And the query itself takes one identifier: no page, no filter, no tenant, no depth. */
  it('takes one employment identifier and nothing else', () => {
    const source = readFileSync(join(APPLICATION, 'identity-queries.ts'), 'utf8');
    const declaration = /interface ActiveMembershipsForEmployment extends Query \{([^}]*)\}/.exec(
      source,
    );
    const fields = (declaration?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly'));

    expect(fields).toStrictEqual([
      "readonly queryName: 'identity.active-memberships-for-employment';",
      'readonly employmentId: string;',
    ]);
  });
});
