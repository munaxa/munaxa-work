import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * What cannot be rewritten, and the two rules that differ from Documents'.
 *
 * **A template version freezes on issuance, not on publication.** It is authoring content and may
 * legitimately be edited right up until it issues something; from that moment editing it would
 * silently change what a historical letter claims to have been generated from. This is a *condition*
 * rather than a table-wide rule, so only the database can check it on every path — the absence of a
 * method could not.
 *
 * **An issued letter is frozen from the instant it exists**, because somebody may be holding a
 * printed copy of it. The only permitted touch is the supersession stamp, which records that a
 * correction replaced it without changing a word of what it said.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Letters immutability suite');

suite('letters immutability', () => {
  let fixture: LettersFixture;

  beforeAll(async () => {
    fixture = await openLettersFixture('letters_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('lets a version that has issued nothing be edited', async () => {
    const template = aTemplate();
    const version = aTemplateVersion(template.letterTemplateId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.templates.insert(transaction, template);
      await fixture.stores.templateVersions.insert(transaction, version);
      await fixture.stores.templateVersions.update(
        transaction,
        { ...version, status: 'published' },
        version.version,
      );
    });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.templateVersions.byId(transaction, version.letterTemplateVersionId),
    );

    // Publication is not the freeze. Nothing depends on this version yet.
    expect(read?.status).toBe('published');
    expect(read?.firstIssuedAt).toBeUndefined();
  });

  it('freezes a version the moment it issues a letter', async () => {
    const { version } = await issued(fixture);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.templateVersions.markFirstIssued(
        transaction,
        version.letterTemplateVersionId,
        new Date('2026-08-11T10:00:00Z'),
      ),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update letter_template_version set body = $1 where id = $2`, [
          JSON.stringify({ en: 'Rewritten.', ar: 'معاد كتابته.' }),
          version.letterTemplateVersionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('stamps the first issuance once and never moves it', async () => {
    const { version } = await issued(fixture);
    const stamp = (moment: string): Promise<void> =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.templateVersions.markFirstIssued(
          transaction,
          version.letterTemplateVersionId,
          new Date(moment),
        ),
      );

    await stamp('2026-08-11T10:00:00Z');
    // A second issuance does not move the date, and the trigger would refuse the update anyway.
    await stamp('2026-09-11T10:00:00Z');

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.templateVersions.byId(transaction, version.letterTemplateVersionId),
    );

    expect(read?.firstIssuedAt?.toISOString()).toBe('2026-08-11T10:00:00.000Z');
  });

  it('refuses every change to an issued letter’s content', async () => {
    const { letter } = await issued(fixture);

    for (const [column, value] of [
      ['reference_number', 'LTR-999999'],
      ['issued_by', 'user:somebody-else'],
      ['substituted_values', JSON.stringify({ 'person.fullName': 'Somebody Else' })],
    ] as const) {
      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`update letter_issued set ${column} = $1 where id = $2`, [
            value,
            letter.issuedLetterId,
          ]),
        ),
      ).rejects.toThrow();
    }
  });

  it('refuses a delete of an issued letter', async () => {
    const { letter } = await issued(fixture);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from letter_issued where id = $1`, [letter.issuedLetterId]),
      ),
    ).rejects.toThrow();
  });

  it('permits the supersession stamp, and leaves the original exactly as issued', async () => {
    const { template, version, letter } = await issued(fixture);
    const correction = aRequest(template, version);
    const replacement = anIssuedLetter(correction, version, {
      referenceNumber: 'LTR-000002',
      verificationToken: aToken('token-b'),
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, correction);
      await fixture.stores.issued.insert(transaction, replacement);
      await fixture.stores.issued.supersede(
        transaction,
        letter.issuedLetterId,
        replacement.issuedLetterId,
        new Date('2026-08-12T10:00:00Z'),
      );
    });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byId(transaction, letter.issuedLetterId),
    );

    expect(read?.supersededById).toBe(replacement.issuedLetterId);
    // Somebody may be holding a printed copy: the correction adds a pointer, it does not edit.
    expect(read?.referenceNumber).toBe('LTR-000001');
    expect(read?.substitutedValues).toEqual({ 'person.fullName': 'Layla Haddad' });
  });

  it('writes the supersession pointer once, and refuses to repoint or clear it', async () => {
    const { template, version, letter } = await issued(fixture);
    const corrections = [aToken('token-b'), aToken('token-c')].map((token, index) => {
      const request = aRequest(template, version);

      return {
        request,
        letter: anIssuedLetter(request, version, {
          referenceNumber: `LTR-00000${String(index + 2)}`,
          verificationToken: token,
        }),
      };
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      for (const correction of corrections) {
        await fixture.stores.requests.insert(transaction, correction.request);
        await fixture.stores.issued.insert(transaction, correction.letter);
      }
    });

    const first = corrections[0]?.letter.issuedLetterId ?? '';

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.supersede(
        transaction,
        letter.issuedLetterId,
        first,
        new Date('2026-08-12T10:00:00Z'),
      ),
    );

    // The chain of corrections is history: it is appended to, never rewritten. A pointer that
    // could be moved afterwards would let somebody change which letter replaced which, long after
    // a bank acted on one of them.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update letter_issued set superseded_by_id = $1 where id = $2`, [
          corrections[1]?.letter.issuedLetterId ?? '',
          letter.issuedLetterId,
        ]),
      ),
    ).rejects.toThrow();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update letter_issued set superseded_by_id = null where id = $1`, [
          letter.issuedLetterId,
        ]),
      ),
    ).rejects.toThrow();

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byId(transaction, letter.issuedLetterId),
    );

    expect(read?.supersededById).toBe(first);
  });
});

/** A template, a published version, a request and one issued letter. */
const issued = async (
  fixture: LettersFixture,
): Promise<{
  readonly template: ReturnType<typeof aTemplate>;
  readonly version: ReturnType<typeof aTemplateVersion>;
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

  return { template, version, letter };
};
