import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Request, Response } from 'express';
import { currentContext, uuidV7 } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { describe, expect, it } from 'vitest';

import { TenantMiddleware } from '../tenancy/tenant.middleware.js';

import { PlatformPermissionChecker } from './permission-checker.js';
import { workGrantsFrom, type DroppedGrant } from './platform-grants.js';
import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from './platform-token-authentication.js';
import { WORK_PERMISSION_CATALOGUE, workPermissionCatalogue } from './work-permission-catalogue.js';

/**
 * The Testing personas Identity provisions (MW-003), as Work receives them.
 *
 * `testing-personas.fixture.json` is generated in munaxa-identity, never written by hand:
 *
 *   node apps/api/scripts/work-roles.mjs --testing-personas \
 *     > ../munaxa-work/apps/api/src/identity/testing-personas.fixture.json
 *
 * A copy rather than an import, because a product never imports another product. Identity's
 * `token-size.integration.test.ts` proves each persona fits a cookie; this suite proves the other
 * half: each persona's grants survive Work's translation intact, reach the operations its job needs,
 * and are refused the operations outside it, through the real token adapter, tenancy middleware and
 * permission checker. A fixture that drifts from Work's catalogue fails here, by name.
 */

interface Persona {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly grants: readonly string[];
}

const FIXTURE = 'apps/api/src/identity/testing-personas.fixture.json';

/** The fixture, found by walking up from the working directory (see work-permission-catalogue.spec.ts). */
const fixturePath = (): string => {
  let directory = process.cwd();

  while (!existsSync(resolve(directory, FIXTURE))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Could not find ${FIXTURE} above the working directory.`);
    directory = parent;
  }
  return resolve(directory, FIXTURE);
};

const PERSONAS: readonly Persona[] = JSON.parse(
  readFileSync(fixturePath(), 'utf8'),
) as readonly Persona[];

const persona = (key: string): Persona => {
  const found = PERSONAS.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`No persona ${key} in the fixture.`);
  return found;
};

/** The Work permissions a persona's token confers, after Work's own translation. */
const conferred = (key: string): { granted: ReadonlySet<string>; dropped: DroppedGrant[] } => {
  const dropped: DroppedGrant[] = [];
  const granted = workGrantsFrom(persona(key).grants, WORK_PERMISSION_CATALOGUE, (entry) => {
    dropped.push(entry);
  });
  return { granted, dropped };
};

/**
 * What each persona exists to do, and what it must not be able to do.
 *
 * Each entry is an operation the pipeline routes (its command or query name) and the permission its
 * handler declares. `reaches` is the job; `refused` is the edge of the job — above all, the
 * decisions that belong to somebody else.
 */
interface Scope {
  readonly reaches: readonly (readonly [operation: string, permission: string])[];
  readonly refused: readonly (readonly [operation: string, permission: string])[];
}

const SCOPES: Readonly<Record<string, Scope>> = {
  'work-testing-org-admin': {
    reaches: [
      ['organization.create-unit', 'organization.unit.manage'],
      ['organization.amend-legal-entity', 'organization.legal-entity.manage'],
      ['identity.invite-member', 'identity.invitation.manage'],
      ['workflow.create-definition', 'workflow.definition.manage'],
    ],
    refused: [
      ['organization.approve-establishment', 'organization.establishment.approve'],
      ['workflow.decide-step', 'workflow.approval.decide'],
      ['payroll.define-group', 'payroll.manage'],
      ['people.create-person', 'people.person.manage'],
    ],
  },
  'work-testing-hr-officer': {
    reaches: [
      ['people.create-person', 'people.person.manage'],
      ['people identifier value', 'people.identifier.read-value'],
      ['employment.create-employment', 'employment.employment.manage'],
      ['relations.record-violation', 'relations.violation.record'],
      // The organisation's side of career: deciding what the manager put forward.
      ['career.decide-move', 'career.mobility.decide'],
      ['career.confirm-successor', 'career.successor.confirm'],
    ],
    refused: [
      ['payroll.define-group', 'payroll.manage'],
      ['leave.decide-request', 'leave.approve'],
      ['compensation.assign-recurring', 'compensation.manage'],
      ['career.recommend-move', 'career.mobility.recommend'],
      ['career.nominate-successor', 'career.successor.nominate'],
    ],
  },
  'work-testing-time-leave-officer': {
    reaches: [
      ['attendance.publish-shift', 'attendance.schedule.publish'],
      ['leave.grant-entitlement', 'leave.entitlement.manage'],
      ['leave.run-accrual', 'leave.accrual.run'],
    ],
    refused: [
      ['leave.decide-request', 'leave.approve'],
      ['attendance.approve-day', 'attendance.approve'],
      ['attendance.decide-correction', 'attendance.correct.approve'],
      ['payroll.define-group', 'payroll.manage'],
    ],
  },
  'work-testing-payroll-preparer': {
    reaches: [
      ['payroll.define-group', 'payroll.manage'],
      ['payroll.calculate', 'payroll.calculate'],
      ['payroll.adjustment-reasons', 'payroll.adjust'],
      ['payroll.accounting-output', 'payroll.accounting'],
      ['compensation.assign-recurring', 'compensation.manage'],
      ['assets.issue-custody', 'assets.custody.assign'],
      ['learning.create-course-category', 'learning.catalogue.manage'],
    ],
    refused: [
      ['payroll.approve', 'payroll.approve'],
      ['payroll.finalize', 'payroll.finalize'],
      ['payroll.payment-instructions', 'payroll.payment'],
      ['payroll.reverse-run', 'payroll.reverse'],
      ['compensation.decide', 'compensation.approve'],
    ],
  },
  'work-testing-payroll-approver': {
    reaches: [
      ['payroll.approve', 'payroll.approve'],
      ['payroll.finalize', 'payroll.finalize'],
      ['payroll.payment-instructions', 'payroll.payment'],
      ['payroll.reverse-run', 'payroll.reverse'],
      ['compensation.decide', 'compensation.approve'],
    ],
    refused: [
      ['payroll.define-group', 'payroll.manage'],
      ['payroll.calculate', 'payroll.calculate'],
      ['payroll.adjustment-reasons', 'payroll.adjust'],
      ['compensation.assign-recurring', 'compensation.manage'],
    ],
  },
  'work-testing-recruiter': {
    reaches: [
      ['recruitment.create-candidate', 'recruitment.candidate.manage'],
      ['recruitment.draft-offer', 'recruitment.offer.manage'],
      ['onboarding.start-onboarding', 'onboarding.start'],
      ['letters.issue', 'letter.issue'],
    ],
    refused: [
      ['recruitment.decide-offer', 'recruitment.offer.approve'],
      ['recruitment.decide-requisition', 'recruitment.requisition.approve'],
      ['payroll.define-group', 'payroll.manage'],
    ],
  },
  'work-testing-manager': {
    reaches: [
      ['leave.decide-request', 'leave.approve'],
      ['attendance.approve-day', 'attendance.approve'],
      ['workflow.decide-step', 'workflow.approval.decide'],
      ['recruitment.decide-offer', 'recruitment.offer.approve'],
      ['organization.approve-establishment', 'organization.establishment.approve'],
      ['performance.schedule-calibration', 'performance.calibrate'],
      ['career.recommend-move', 'career.mobility.recommend'],
      ['career.nominate-successor', 'career.successor.nominate'],
    ],
    refused: [
      // Nominating and recommending are the manager's; agreeing with them is not (M2).
      ['career.decide-move', 'career.mobility.decide'],
      ['career.confirm-successor', 'career.successor.confirm'],
      ['payroll.approve', 'payroll.approve'],
      ['compensation.decide', 'compensation.approve'],
      ['leave.grant-entitlement', 'leave.entitlement.manage'],
      ['recruitment.draft-offer', 'recruitment.offer.manage'],
      ['people.create-person', 'people.person.manage'],
    ],
  },
  'work-testing-employee': {
    reaches: [
      ['identity.accept-invitation', 'identity.invitation.accept'],
      ['identity.revise-preference', 'identity.preference.manage'],
      ['attendance.request-correction', 'attendance.correct.request'],
      ['performance.give-feedback', 'performance.feedback.give'],
      ['workflow.pending-approvals', 'workflow.approval.read-own'],
    ],
    refused: [
      ['people.create-person', 'people.person.manage'],
      ['leave.decide-request', 'leave.approve'],
      ['payroll.define-group', 'payroll.manage'],
      ['attendance.decide-correction', 'attendance.correct.approve'],
      ['identity.invite-member', 'identity.invitation.manage'],
    ],
  },
};

const KEYS = [
  'work-testing-org-admin',
  'work-testing-hr-officer',
  'work-testing-time-leave-officer',
  'work-testing-payroll-preparer',
  'work-testing-payroll-approver',
  'work-testing-recruiter',
  'work-testing-manager',
  'work-testing-employee',
];

describe('the Testing persona fixture', () => {
  it('holds exactly the eight fixed persona keys', () => {
    expect(PERSONAS.map((entry) => entry.key)).toEqual(KEYS);
    expect(Object.keys(SCOPES)).toEqual(KEYS);
  });

  it.each(KEYS)('%s is marked as Testing only', (key) => {
    expect(persona(key).name).toContain('Testing only');
    expect(persona(key).description.startsWith('TESTING ONLY.')).toBe(true);
  });

  it.each(KEYS)('%s loses no grant to Work translation', (key) => {
    const { granted, dropped } = conferred(key);

    expect(dropped).toEqual([]);
    expect(granted.size).toBe(persona(key).grants.length);
  });

  it('covers every permission Work declares', () => {
    const held = new Set(KEYS.flatMap((key) => [...conferred(key).granted]));

    expect(workPermissionCatalogue().filter((permission) => !held.has(permission))).toEqual([]);
  });

  it('names only declared permissions in the scopes below', () => {
    for (const { reaches, refused } of Object.values(SCOPES)) {
      for (const [operation, permission] of [...reaches, ...refused]) {
        expect([operation, WORK_PERMISSION_CATALOGUE.has(permission)]).toEqual([operation, true]);
      }
    }
  });

  it('keeps payroll approval and payroll preparation in different personas', () => {
    const preparation = ['payroll.manage', 'payroll.calculate', 'payroll.adjust'];
    const decisions = ['payroll.approve', 'payroll.finalize', 'payroll.payment', 'payroll.reverse'];

    for (const key of KEYS) {
      const { granted } = conferred(key);
      const both =
        preparation.some((permission) => granted.has(permission)) &&
        decisions.some((permission) => granted.has(permission));

      expect([key, both]).toEqual([key, false]);
    }
    for (const permission of decisions) {
      expect(KEYS.filter((key) => conferred(key).granted.has(permission))).toEqual([
        'work-testing-payroll-approver',
      ]);
    }
  });

  it('never puts a decision beside anything else in its module but reads and own records', () => {
    // One rule for every persona, with no persona exempt by name: whoever decides in a module
    // prepares nothing there, so nobody decides what they prepared. Decisions are named by Work's
    // own verbs, not by the fixture's word for which grants are decisions.
    const isDecision = (permission: string): boolean =>
      /\.(approve|finalize|decide|confirm|payment|reverse)$/.test(permission);
    const isReadOrOwn = (permission: string): boolean =>
      /\.read(-[a-z-]+)?$/.test(permission) || permission.endsWith('-own');
    const moduleOf = (permission: string): string => permission.split('.')[0] ?? '';

    for (const key of KEYS) {
      const granted = [...conferred(key).granted];
      const deciding = new Set(granted.filter(isDecision).map(moduleOf));
      const besideADecision = granted.filter(
        (permission) =>
          deciding.has(moduleOf(permission)) && !isDecision(permission) && !isReadOrOwn(permission),
      );

      expect([key, besideADecision]).toEqual([key, []]);
    }
  });
});

const PLATFORM_USER = 'platform-user-persona';
const TENANT = uuidV7();

const membership: ResolvedMembership = {
  tenantId: TENANT,
  membershipId: uuidV7(),
  workforceUserId: uuidV7(),
  platformUserId: PLATFORM_USER,
  status: 'active',
};

const directory: TenantMembershipDirectory = {
  activeMembershipsOf: () => Promise.resolve([membership]),
};

const vouchingFor = (perms: readonly string[]): AccessTokenVerifier => ({
  verifyAccessToken: () => ({
    sub: PLATFORM_USER,
    iss: 'https://identity.example.com',
    iat: 1_780_000_000,
    exp: 1_780_000_900,
    tid: 'org-a',
    sid: 'sess-persona',
    perms,
  }),
});

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers, correlationId: uuidV7() }) as unknown as Request;

/** One request as the persona: the real adapter, the real middleware, the real checker. */
const holds = async (key: string, permission: string): Promise<boolean> => {
  const middleware = new TenantMiddleware(
    new PlatformTokenAuthenticationPort(vouchingFor(persona(key).grants)),
    directory,
  );
  let allowed = false;
  let tenantId: string | undefined;

  await middleware.use(
    requestWith({ authorization: 'Bearer a-persona-token' }),
    {} as Response,
    () => {
      const context = currentContext();
      tenantId = context !== undefined && !('system' in context) ? context.tenantId : undefined;
      void new PlatformPermissionChecker().holds(permission).then((held) => {
        allowed = held;
      });
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  // Every answer below is given inside the persona's tenant, so a refusal is an authorization
  // decision and never a tenancy failure that happened to look like one.
  expect(tenantId).toBe(TENANT);
  return allowed;
};

describe.each(KEYS)('the persona %s', (key) => {
  const scope = SCOPES[key];
  if (scope === undefined) throw new Error(`No scope for ${key}.`);

  it.each(scope.reaches)('reaches %s (%s)', async (_operation, permission) => {
    expect(await holds(key, permission)).toBe(true);
  });

  it.each(scope.refused)('is refused %s (%s)', async (_operation, permission) => {
    expect(await holds(key, permission)).toBe(false);
  });
});
