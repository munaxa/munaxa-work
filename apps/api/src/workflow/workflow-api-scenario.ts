import type { INestApplication } from '@nestjs/common';

import { http } from './workflow-api.fixture.js';

/**
 * The requests every API suite makes, written once.
 *
 * A scenario is four calls — define, draft, add a step, publish — before anything interesting can
 * happen, and repeating them in six files would make each suite's first thirty lines identical and
 * its assertions harder to find.
 *
 * **Every call goes over HTTP.** Nothing here reaches a handler, a dispatcher or a repository
 * directly: the point of these suites is the wire, and a helper that took a shortcut would quietly
 * remove the layer under test.
 */

export const BASE = '/api/v1/workflow';

export interface Created {
  readonly definitionId?: string;
  readonly workflowVersionId?: string;
  readonly instanceId?: string;
  readonly stepTemplateId?: string;
  readonly approvalGroupId?: string;
  readonly approvalGroupMemberId?: string;
  readonly created?: boolean;
}

/** A `POST` as a named actor and membership, returning the body whatever the status. */
export const post = async (
  application: INestApplication,
  path: string,
  body: Record<string, unknown>,
  as?: { readonly actor?: string; readonly member?: string },
): Promise<{ readonly status: number; readonly body: Created & Record<string, unknown> }> => {
  const request = http(application).post(`${BASE}${path}`);

  if (as?.actor !== undefined) void request.set('x-test-actor', as.actor);
  if (as?.member !== undefined) void request.set('x-test-member', as.member);

  const response = await request.send(body);

  return { status: response.status, body: response.body as Created & Record<string, unknown> };
};

export const get = async (
  application: INestApplication,
  path: string,
  as?: { readonly actor?: string; readonly member?: string },
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> => {
  const request = http(application).get(`${BASE}${path}`);

  if (as?.actor !== undefined) void request.set('x-test-actor', as.actor);
  if (as?.member !== undefined) void request.set('x-test-member', as.member);

  const response = await request.send();

  return { status: response.status, body: response.body as Record<string, unknown> };
};

/** Fails loudly with the body, so a broken step names itself rather than the next one. */
const must = (
  outcome: { readonly status: number; readonly body: Record<string, unknown> },
  what: string,
): Created => {
  if (outcome.status >= 400) {
    throw new Error(
      `${what} failed with ${String(outcome.status)}: ${JSON.stringify(outcome.body)}`,
    );
  }
  return outcome.body;
};

export interface PublishedWorkflow {
  readonly definitionId: string;
  readonly workflowVersionId: string;
}

const NAME = { en: 'Approval', ar: 'اعتماد' };

let sequence = 0;

/**
 * A definition with one published version, through four HTTP calls.
 *
 * The code is unique per call so a suite never accidentally tests the uniqueness index when it meant
 * to test something else.
 */
export const publishedWorkflow = async (
  application: INestApplication,
  options: {
    readonly approver: string;
    readonly subjectType?: string;
    readonly approvers?: readonly string[];
  },
): Promise<PublishedWorkflow> => {
  sequence += 1;

  const definition = must(
    await post(application, '/definitions', {
      code: `approval-${String(sequence)}`,
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      subjectType: options.subjectType ?? 'recruitment.requisition',
    }),
    'creating a definition',
  );
  const version = must(
    await post(application, `/definitions/${String(definition.definitionId)}/versions`, {}),
    'drafting a version',
  );
  const approvers = options.approvers ?? [options.approver];

  for (const [index, approver] of approvers.entries()) {
    must(
      await post(application, `/versions/${String(version.workflowVersionId)}/steps`, {
        ordinal: index + 1,
        name: NAME,
        approverMembershipId: approver,
      }),
      'adding a step',
    );
  }
  must(
    await post(application, `/versions/${String(version.workflowVersionId)}/publication`, {
      expectedVersion: 1,
    }),
    'publishing',
  );

  return {
    definitionId: String(definition.definitionId),
    workflowVersionId: String(version.workflowVersionId),
  };
};

/**
 * A definition with a **draft** version, and nothing else.
 *
 * The branch suites configure steps one at a time and want each refusal to be their own, so they
 * cannot use `publishedWorkflow` — which adds a step and publishes before they have said anything.
 */
export const aDraftVersion = async (
  application: INestApplication,
  subjectType: string,
): Promise<PublishedWorkflow> => {
  sequence += 1;

  const definition = must(
    await post(application, '/definitions', {
      code: `branch-${String(sequence)}`,
      name: NAME,
      subjectType,
    }),
    'creating a definition',
  );
  const version = must(
    await post(application, `/definitions/${String(definition.definitionId)}/versions`, {}),
    'drafting a version',
  );

  return {
    definitionId: String(definition.definitionId),
    workflowVersionId: String(version.workflowVersionId),
  };
};

export interface SeededGroup {
  readonly approvalGroupId: string;
  readonly approvalGroupMemberId: string;
}

/**
 * A list with the memberships on it, over HTTP.
 *
 * Returns the **first** member's row identifier as well as the group's, because removal addresses
 * the membership row rather than the pair — the application's command takes one identifier, and a
 * helper that returned only the group would leave every removal test reading the group back first.
 */
export const anApprovalGroup = async (
  application: INestApplication,
  members: readonly string[],
): Promise<SeededGroup> => {
  sequence += 1;

  const group = must(
    await post(application, '/approval-groups', {
      code: `list-${String(sequence)}`,
      name: { en: 'Capital approvers', ar: 'معتمدو النفقات' },
    }),
    'creating an approval group',
  );
  const created: string[] = [];

  for (const membershipId of members) {
    const member = must(
      await post(application, `/approval-groups/${String(group.approvalGroupId)}/members`, {
        membershipId,
      }),
      'adding a group member',
    );

    created.push(String(member.approvalGroupMemberId));
  }

  return {
    approvalGroupId: String(group.approvalGroupId),
    approvalGroupMemberId: created[0] ?? '',
  };
};

/** A published workflow and a running approval about a subject. */
export const runningApproval = async (
  application: INestApplication,
  options: {
    readonly approver: string;
    readonly subjectId: string;
    readonly subjectType?: string;
    readonly approvers?: readonly string[];
  },
): Promise<PublishedWorkflow & { readonly instanceId: string }> => {
  const published = await publishedWorkflow(application, options);
  const started = must(
    await post(application, '/instances', {
      definitionId: published.definitionId,
      subjectType: options.subjectType ?? 'recruitment.requisition',
      subjectId: options.subjectId,
      context: { headcount: 2 },
    }),
    'starting an approval',
  );

  return { ...published, instanceId: String(started.instanceId) };
};
