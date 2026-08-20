import type { ApprovalGroupMemberState, ApprovalGroupState } from '../domain/approval-group.js';
import type { LocalizedName } from '../domain/workflow-vocabulary.js';
import { asNumber, type RowValues } from './row-writer.js';

/**
 * The two tables an approval group is: the list, and the memberships on it.
 *
 * **`membership_id` is a `uuid` column holding Identity's identifier as a value.** There is no
 * foreign key to Identity and no join anywhere on this path: a membership means whatever Identity
 * means by it, and a reference across a module boundary would couple two schemas' migration order
 * while providing no isolation at all (ADR-0042).
 *
 * **The group reference on a member row is composite — `(approval_group_id, tenant_id)`.** That is
 * not a mapper concern except in one respect: `tenant_id` is written on every row by
 * `insertRow`'s caller, and it is the second half of the key that stops one tenant attaching a member
 * to another tenant's list. PostgreSQL checks a foreign key without consulting a row-level policy, so
 * the tenant has to be *inside* the key rather than beside it.
 *
 * `name` is the one `jsonb` column here, and it is tenant-authored bilingual text — the same
 * treatment a definition's `name` gets. `added_at` is a `timestamptz` the driver hands back as a
 * `Date` and the mapper passes through untouched: there is no civil date in this module.
 */

const localized = (value: unknown): LocalizedName => value as LocalizedName;

export interface GroupRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly version: number;
}

export const groupColumns = (alias: string): string =>
  [`${alias}.id`, `${alias}.code`, `${alias}.name`, `${alias}.version`].join(', ');

export const groupState = (row: GroupRow): ApprovalGroupState => ({
  approvalGroupId: row.id,
  code: row.code,
  name: localized(row.name),
  version: asNumber(row.version),
});

/**
 * A group, on its way in.
 *
 * No status, no archived-at, no effective period and no owner — because the table has none. A group
 * is a list somebody wrote down; a list nobody wants any more has its members removed, and the
 * ordinary soft delete every table in this repository carries is the only lifecycle there is.
 */
export const groupValues = (state: ApprovalGroupState, tenantId: string): RowValues => ({
  id: state.approvalGroupId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
});

export interface GroupMemberRow {
  readonly id: string;
  readonly approval_group_id: string;
  readonly membership_id: string;
  readonly added_at: Date;
  readonly version: number;
}

export const memberColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.approval_group_id`,
    `${alias}.membership_id`,
    `${alias}.added_at`,
    `${alias}.version`,
  ].join(', ');

export const memberState = (row: GroupMemberRow): ApprovalGroupMemberState => ({
  approvalGroupMemberId: row.id,
  approvalGroupId: row.approval_group_id,
  membershipId: row.membership_id,
  addedAt: row.added_at,
  version: asNumber(row.version),
});

export const memberValues = (state: ApprovalGroupMemberState, tenantId: string): RowValues => ({
  id: state.approvalGroupMemberId,
  tenant_id: tenantId,
  approval_group_id: state.approvalGroupId,
  membership_id: state.membershipId,
  added_at: state.addedAt,
});
