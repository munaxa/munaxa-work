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
  aRequest,
  aTemplate,
  aTemplateVersion,
  aToken,
  anIssuedLetter,
} from './letters-fixtures.js';

/**
 * Two administrators, at the same moment.
 *
 * Every assertion here starts **two real transactions on two real connections** and lets them race.
 * A suite that awaited one and then the other would prove only that sequential writes work, which
 * nobody doubted.
 *
 * The race that matters most in this module is the counter. A reference number must be unique and
 * gapless per tenant, and two issuances at the same instant are exactly the case a naive
 * read-then-write would get wrong — both would read 1, both would write 2, and two letters would go
 * out bearing `LTR-000001`.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Letters concurrency suite');

suite('letters concurrency', () => {
  let fixture: LettersFixture;

  beforeAll(async () => {
    fixture = await openLettersFixture('letters_concurrency_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('gives two simultaneous issuances two different reference numbers', async () => {
    const allocated = await Promise.all([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.numbers.allocate(transaction, 'letter'),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.numbers.allocate(transaction, 'letter'),
      ),
    ]);

    // `insert ... on conflict do update` serializes on the row, so the second waits rather than
    // reading a stale value. Two letters bearing LTR-000001 is the failure this prevents.
    expect(new Set(allocated).size).toBe(2);
    expect([...allocated].sort((one, other) => one - other)).toEqual([1, 2]);
  });

  it('lets one of two simultaneous letters with the same reference win', async () => {
    const { template, version } = await seeded(fixture);
    const issue = (token: string): Promise<void> =>
      fixture.asTenant(TENANT_A, async (transaction) => {
        const request = aRequest(template, version);

        await fixture.stores.requests.insert(transaction, request);
        await fixture.stores.issued.insert(
          transaction,
          anIssuedLetter(request, version, {
            referenceNumber: 'LTR-000042',
            verificationToken: token,
          }),
        );
      });

    const outcomes = await Promise.allSettled([issue(aToken('token-x')), issue(aToken('token-y'))]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);
  });

  it('lets one of two simultaneous decisions at the same sequence win', async () => {
    const { request } = await seeded(fixture);
    const decide = (decidedBy: string): Promise<void> => {
      const decision = recordDecision({
        approvalDecisionId: uuidV7(),
        letterRequestId: request.letterRequestId,
        sequence: 1,
        decision: 'approved',
        requestedBy: request.requestedBy,
        decidedBy,
        decidedAt: new Date('2026-08-11T11:00:00Z'),
      });

      if (!decision.ok) throw new Error('the fixture built an invalid decision');
      return fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.insert(transaction, decision.value),
      );
    };

    const outcomes = await Promise.allSettled([
      decide('user:approver-one'),
      decide('user:approver-two'),
    ]);

    // The unique index on `(letter_request_id, sequence)`: an approval chain with two number-ones
    // is a chain nobody can read.
    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses the second of two edits made against the same request version', async () => {
    const { request } = await seeded(fixture);

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requests.update(
          transaction,
          { ...request, status: 'cancelled' },
          request.version,
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requests.update(
          transaction,
          { ...request, status: 'generating' },
          request.version,
        ),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);
  });

  it('lets two simultaneous template definitions with the same code produce one row', async () => {
    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.templates.insert(transaction, aTemplate({ code: 'salary-certificate' })),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.templates.insert(transaction, aTemplate({ code: 'salary-certificate' })),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);

    const templates = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.templates.all(transaction),
    );

    expect(templates).toHaveLength(1);
  });
});

/** A template, a published version and one request. */
const seeded = async (
  fixture: LettersFixture,
): Promise<{
  readonly template: ReturnType<typeof aTemplate>;
  readonly version: ReturnType<typeof aTemplateVersion>;
  readonly request: ReturnType<typeof aRequest>;
}> => {
  const template = aTemplate();
  const version = { ...aTemplateVersion(template.letterTemplateId), status: 'published' as const };
  const request = aRequest(template, version);

  await fixture.asTenant(TENANT_A, async (transaction) => {
    await fixture.stores.templates.insert(transaction, template);
    await fixture.stores.templateVersions.insert(transaction, version);
    await fixture.stores.requests.insert(transaction, request);
  });

  return { template, version, request };
};
