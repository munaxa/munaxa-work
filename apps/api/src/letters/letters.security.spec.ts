import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import {
  ALL,
  ADMINISTRATOR,
  VERIFIER,
  applicationWith,
  http,
  permitting,
  type VerificationBody,
} from '../documents/documents-api-harness.js';
import { EMPLOYMENT_ID, PERSON_ID } from '../documents/phase-twelve-upstream.js';

/**
 * What a letter may say, and who may cause it to say it.
 *
 * The assertions here are about three edges:
 *
 * **The pay gate is two gates.** A template must declare `salary` *and* the issuer must hold
 * `letter.include-salary`. Without the second, a letter is a way to read a salary the caller could
 * not read directly (AD-005).
 *
 * **Self-approval is refused at the edge as well as in the domain and the database.** A salary
 * certificate is a document a bank acts on.
 *
 * **Third-party verification discloses almost nothing** — and takes the token in a body rather than
 * a path, because a token in a URL ends up in a proxy log and a browser history.
 */

const PLAIN = {
  en: '{{person.fullName}} has worked at {{organization.legalName}} since {{employment.startDate}}.',
  ar: 'يعمل {{person.fullName}} في {{organization.legalName}} منذ {{employment.startDate}}.',
};

const SALARY = {
  en: '{{person.fullName}} earns {{salary.monthly}}.',
  ar: 'يتقاضى {{person.fullName}} مبلغ {{salary.monthly}}.',
};

interface TemplateCreated {
  readonly letterTemplateId: string;
}

interface VersionCreated {
  readonly letterTemplateVersionId: string;
}

interface RequestCreated {
  readonly letterRequestId: string;
  readonly status: string;
}

interface IssuedBody {
  readonly issuedLetterId: string;
  readonly referenceNumber: string;
  readonly body: string;
}

describe('letters API security', () => {
  let application: INestApplication;

  afterEach(async () => {
    await application.close();
  });

  const publish = async (options: {
    readonly code: string;
    readonly body: { readonly en: string; readonly ar: string };
    readonly variables: readonly string[];
    readonly exposedFields: readonly string[];
    readonly requiresApproval?: boolean;
  }): Promise<string> => {
    const template = await http(application)
      .post('/api/v1/letters/templates')
      .send({
        code: options.code,
        name: { en: 'Certificate', ar: 'شهادة' },
        category: 'employment',
        requiresApproval: options.requiresApproval ?? false,
        employeeRequestable: true,
      })
      .expect(201);
    const letterTemplateId = (template.body as TemplateCreated).letterTemplateId;
    const version = await http(application)
      .post(`/api/v1/letters/templates/${letterTemplateId}/versions`)
      .send({
        body: options.body,
        variables: options.variables,
        exposedFields: options.exposedFields,
      })
      .expect(201);

    await http(application)
      .post(
        `/api/v1/letters/templates/versions/${(version.body as VersionCreated).letterTemplateVersionId}/status`,
      )
      .send({ status: 'published', expectedVersion: 1 })
      .expect(201);

    return letterTemplateId;
  };

  const requestFor = async (letterTemplateId: string, actor?: string): Promise<string> => {
    const created = await http(application)
      .post('/api/v1/letters/requests')
      .set(actor === undefined ? {} : { 'x-test-actor': actor })
      .send({ letterTemplateId, employmentId: EMPLOYMENT_ID, personId: PERSON_ID, locale: 'en' })
      .expect(201);

    return (created.body as RequestCreated).letterRequestId;
  };

  describe('with every permission', () => {
    beforeEach(async () => {
      application = await applicationWith(permitting(...ALL));
    });

    it('resolves the literal template route rather than treating it as a request identifier', async () => {
      const listed = await http(application).get('/api/v1/letters/templates').expect(200);

      expect(listed.body).toEqual({ items: [] });
    });

    it('generates from the published contracts and produces no file', async () => {
      const letterTemplateId = await publish({
        code: 'employment-certificate',
        body: PLAIN,
        variables: ['person.fullName', 'employment.startDate', 'organization.legalName'],
        exposedFields: ['person', 'employment', 'organization'],
      });
      const issued = await http(application)
        .post(`/api/v1/letters/requests/${await requestFor(letterTemplateId)}/issue`)
        .send({})
        .expect(201);
      const body = issued.body as IssuedBody;

      expect(body.body).toBe('Layla Haddad has worked at Munaxa LLC since 2024-03-01.');
      expect(body.referenceNumber).toBe('LTR-000001');

      const detail = await http(application)
        .get(`/api/v1/letters/issued/${body.issuedLetterId}`)
        .expect(200);

      // No renderer exists in this repository: content, and no artefact (D-15).
      expect(
        (detail.body as { letter: { documentId?: string } }).letter.documentId,
      ).toBeUndefined();
    });

    it('refuses a template variable that is an expression rather than a name', async () => {
      const template = await http(application)
        .post('/api/v1/letters/templates')
        .send({
          code: 'injection-attempt',
          name: { en: 'Certificate', ar: 'شهادة' },
          category: 'employment',
          requiresApproval: false,
          employeeRequestable: true,
        })
        .expect(201);

      // Substitution is a lookup. There is no expression language, and the edge refuses one.
      await http(application)
        .post(
          `/api/v1/letters/templates/${(template.body as TemplateCreated).letterTemplateId}/versions`,
        )
        .send({
          body: { en: '{{person.fullName}}', ar: '{{person.fullName}}' },
          variables: ['person.fullName || salary.monthly'],
          exposedFields: ['person'],
        })
        .expect(400);
    });

    it('refuses a request in a language the product does not have', async () => {
      const letterTemplateId = await publish({
        code: 'employment-certificate',
        body: PLAIN,
        variables: ['person.fullName', 'employment.startDate', 'organization.legalName'],
        exposedFields: ['person', 'employment', 'organization'],
      });

      await http(application)
        .post('/api/v1/letters/requests')
        .send({ letterTemplateId, employmentId: EMPLOYMENT_ID, personId: PERSON_ID, locale: 'fr' })
        .expect(400);
    });

    it('refuses the requester approving their own letter', async () => {
      const letterTemplateId = await publish({
        code: 'salary-certificate',
        body: PLAIN,
        variables: ['person.fullName', 'employment.startDate', 'organization.legalName'],
        exposedFields: ['person', 'employment', 'organization'],
        requiresApproval: true,
      });
      const letterRequestId = await requestFor(letterTemplateId, ADMINISTRATOR);

      await http(application)
        .post(`/api/v1/letters/requests/${letterRequestId}/decisions`)
        .set({ 'x-test-actor': ADMINISTRATOR })
        .send({ decision: 'approved' })
        .expect(422);

      await http(application)
        .post(`/api/v1/letters/requests/${letterRequestId}/decisions`)
        .set({ 'x-test-actor': VERIFIER })
        .send({ decision: 'approved' })
        .expect(201);
    });

    it('confirms a letter by token and discloses no employee data', async () => {
      const letterTemplateId = await publish({
        code: 'employment-certificate',
        body: PLAIN,
        variables: ['person.fullName', 'employment.startDate', 'organization.legalName'],
        exposedFields: ['person', 'employment', 'organization'],
      });

      await http(application)
        .post(`/api/v1/letters/requests/${await requestFor(letterTemplateId)}/issue`)
        .send({})
        .expect(201);

      const register = await http(application).get('/api/v1/letters/issued').expect(200);
      const listed = register.body as {
        readonly items: readonly Record<string, unknown>[];
      };

      // The register carries no token and no substituted values.
      expect(Object.keys(listed.items[0] ?? {})).not.toContain('verificationToken');
      expect(Object.keys(listed.items[0] ?? {})).not.toContain('substitutedValues');

      const wrong = await http(application)
        .post('/api/v1/letters/issued/verification')
        .send({ verificationToken: 'x'.repeat(64) })
        .expect(201);

      // Not "no such letter": over enough attempts that would let somebody enumerate the register.
      expect(wrong.body as VerificationBody).toEqual({ genuine: false });
    });
  });

  describe('without letter.include-salary', () => {
    beforeEach(async () => {
      application = await applicationWith(
        permitting(
          'letter.template.manage',
          'letter.template.read',
          'letter.read',
          'letter.request',
          'letter.issue',
        ),
      );
    });

    it('may issue an ordinary certificate but not one that states pay', async () => {
      const ordinary = await publish({
        code: 'employment-certificate',
        body: PLAIN,
        variables: ['person.fullName', 'employment.startDate', 'organization.legalName'],
        exposedFields: ['person', 'employment', 'organization'],
      });

      await http(application)
        .post(`/api/v1/letters/requests/${await requestFor(ordinary)}/issue`)
        .send({})
        .expect(201);

      const paid = await publish({
        code: 'salary-certificate',
        body: SALARY,
        variables: ['person.fullName', 'salary.monthly'],
        exposedFields: ['person', 'salary'],
      });

      // The template's own gate passed; the caller's did not.
      await http(application)
        .post(`/api/v1/letters/requests/${await requestFor(paid)}/issue`)
        .send({})
        .expect(409);
    });
  });

  describe('with no authenticated context at all', () => {
    beforeEach(async () => {
      application = await applicationWith(permitting(...ALL), { actor: undefined });
    });

    it('reaches no route in this module, including verification', async () => {
      await http(application).get('/api/v1/letters/templates').expect(401);
      await http(application).get('/api/v1/letters/issued').expect(401);
      // The anonymous public verification route is NOT VERIFIED: every read here resolves a tenant
      // first, and row-level security has no anonymous cross-tenant path.
      await http(application)
        .post('/api/v1/letters/issued/verification')
        .send({ verificationToken: 'x'.repeat(64) })
        .expect(401);
    });
  });
});
