import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordDecision } from '../domain/letter-approval.js';
import {
  CONNECTION,
  TENANT_A,
  openLettersFixture,
  requireDatabaseInCi,
  type LettersFixture,
} from './letters-database.fixture.js';
import {
  EMPLOYMENT_ID,
  aRequest,
  aTemplate,
  aTemplateVersion,
  aToken,
  anIssuedLetter,
} from './letters-fixtures.js';

/**
 * What the repositories do against real SQL.
 *
 * The in-memory suites already prove the behaviour; these prove it survives a driver round trip,
 * real column lists and real constraints. The interesting ones are what only the database can
 * settle: the check constraint refusing a self-approved letter, the unique index on the verification
 * token, the `jsonb` snapshot round-tripping exactly, and a gapless counter.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Letters persistence suite');

suite('letters persistence', () => {
  let fixture: LettersFixture;

  beforeAll(async () => {
    fixture = await openLettersFixture('letters_persistence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('round-trips a template version, its array columns included', async () => {
    const template = aTemplate();
    const version = aTemplateVersion(template.letterTemplateId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.templates.insert(transaction, template);
      await fixture.stores.templateVersions.insert(transaction, version);
    });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.templateVersions.byId(transaction, version.letterTemplateVersionId),
    );

    expect(read?.variables).toEqual(['person.fullName']);
    expect(read?.exposedFields).toEqual(['person']);
    expect(read?.body.ar).toContain('نشهد');
  });

  it('round-trips the frozen snapshot exactly', async () => {
    const { letter } = await issued(fixture);

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byId(transaction, letter.issuedLetterId),
    );

    // The snapshot is what makes a letter reproducible. A `jsonb` that reshaped on the way through
    // would make it something else.
    expect(read?.substitutedValues).toEqual({ 'person.fullName': 'Layla Haddad' });
    expect(read?.sourceVersions).toEqual({ person: '1' });
    // No renderer exists in this repository, so there is no artefact and the column says so.
    expect(read?.documentId).toBeUndefined();
  });

  it('allocates a gapless, tenant-scoped reference number', async () => {
    const allocated = await fixture.asTenant(TENANT_A, async (transaction) => [
      await fixture.stores.numbers.allocate(transaction, 'letter'),
      await fixture.stores.numbers.allocate(transaction, 'letter'),
      await fixture.stores.numbers.allocate(transaction, 'letter'),
    ]);

    // Never a PostgreSQL sequence: a rolled-back issue would burn a number and leave a permanent
    // gap in a customer's register that nobody could explain (ADR-0039).
    expect(allocated).toEqual([1, 2, 3]);
  });

  it('refuses a self-approved letter at the database', async () => {
    const { request } = await issued(fixture);
    const decision = recordDecision({
      approvalDecisionId: uuidV7(),
      letterRequestId: request.letterRequestId,
      sequence: 1,
      decision: 'approved',
      requestedBy: 'user:requester',
      decidedBy: 'user:approver',
      decidedAt: new Date('2026-08-11T11:00:00Z'),
    });

    if (!decision.ok) throw new Error('the fixture built an invalid decision');

    // The domain refuses this too; the constraint proves the database would refuse it even from
    // SQL nobody wrote in TypeScript.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.insert(transaction, {
          ...decision.value,
          decidedBy: 'user:requester',
        }),
      ),
    ).rejects.toThrow();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.decisions.insert(transaction, decision.value),
    );

    const held = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.decisions.forRequest(transaction, request.letterRequestId),
    );

    expect(held).toHaveLength(1);
  });

  it('refuses two letters sharing a verification token', async () => {
    const { template, version, letter } = await issued(fixture);
    const second = aRequest(template, version);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, second);
        await fixture.stores.issued.insert(
          transaction,
          anIssuedLetter(second, version, {
            referenceNumber: 'LTR-000002',
            // The same token as the first. A collision would make one letter verify as another.
            verificationToken: letter.verificationToken,
          }),
        );
      }),
    ).rejects.toThrow();
  });

  it('finds a letter by its verification token, and nothing by a wrong one', async () => {
    const { letter } = await issued(fixture);

    const found = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byVerificationToken(transaction, letter.verificationToken),
    );

    expect(found?.referenceNumber).toBe('LTR-000001');

    const missing = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byVerificationToken(transaction, aToken('wrong')),
    );

    expect(missing).toBeUndefined();
  });

  it('searches the register by employment, bounded and counted with the same predicate', async () => {
    const { template, version } = await issued(fixture);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const second = aRequest(template, version);

      await fixture.stores.requests.insert(transaction, second);
      await fixture.stores.issued.insert(
        transaction,
        anIssuedLetter(second, version, {
          referenceNumber: 'LTR-000002',
          verificationToken: aToken('token-b'),
        }),
      );
    });

    const page = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.search(
        transaction,
        { employmentId: EMPLOYMENT_ID },
        { limit: 1, offset: 0 },
      ),
    );

    expect(page.items).toHaveLength(1);
    // The count runs the same `where`: a total from a different predicate is the bug that shows
    // "1 of 40" on a screen holding forty rows.
    expect(page.total).toBe(2);
  });

  it('refuses a template version number already written for that template', async () => {
    const template = aTemplate();

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.templates.insert(transaction, template);
      await fixture.stores.templateVersions.insert(
        transaction,
        aTemplateVersion(template.letterTemplateId, 1),
      );
    });

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.templateVersions.insert(
          transaction,
          aTemplateVersion(template.letterTemplateId, 1),
        ),
      ),
    ).rejects.toThrow();
  });
});

/** A template, a published version, a request and one issued letter. */
const issued = async (
  fixture: LettersFixture,
): Promise<{
  readonly template: ReturnType<typeof aTemplate>;
  readonly version: ReturnType<typeof aTemplateVersion>;
  readonly request: ReturnType<typeof aRequest>;
  readonly letter: ReturnType<typeof anIssuedLetter>;
}> => {
  const template = aTemplate();
  const version = { ...aTemplateVersion(template.letterTemplateId), status: 'published' as const };
  const request = aRequest(template, version);
  const letter = anIssuedLetter(request, version);

  await fixture.asTenant(TENANT_A, async (transaction) => {
    await fixture.stores.templates.insert(transaction, template);
    await fixture.stores.templateVersions.insert(transaction, version);
    await fixture.stores.requests.insert(transaction, request);
    await fixture.stores.issued.insert(transaction, letter);
  });

  return { template, version, request, letter };
};
