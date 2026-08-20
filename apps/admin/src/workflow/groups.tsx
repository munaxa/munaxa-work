import type { ReactNode } from 'react';
import type { ApprovalGroupDetailView, ApprovalGroupView } from '@work/workflow/contracts';

import { count, instant, member, short } from './exact';
import { Empty, named, Section, Table, type SectionProps } from './sections';

/**
 * The lists a tenant keeps of who approves what.
 *
 * **A group is an explicit list of memberships and this screen says so in as many words.** It is not
 * a role, not a department, not an organizational unit, not a manager's reports and not a query
 * against a directory — Workflow holds no such thing and resolves none of them. What a tenant wrote
 * down is what an approval asks. The notice is rendered rather than assumed, because a table of
 * codes and names is exactly the shape a reader would otherwise take for a directory.
 *
 * **A member is a membership identifier and stays one.** Resolving it to a person's name is
 * Identity's read behind Identity's permission; this screen holds no Identity contract and makes no
 * request to one, so a name here would be invented. It is rendered in full for the reason
 * `exact.ts` gives: UUIDv7 identifiers created within a few hours of each other share their first
 * eight characters, and two memberships on one list must never render as one.
 *
 * **A group has no lifecycle, and there is no column here that could imply one.** No status, no
 * owner, no effective period, no parent and no external identity: the view publishes a code, a
 * bilingual name and a row version, and this renders those four things and nothing beside them.
 */

/**
 * Every group in the page, with the server's total beside it.
 *
 * There is **no member-count column**, and its absence is deliberate rather than an omission. The
 * listing view does not carry one, so filling a column would take a detail request per row — fifty
 * requests to render fifty numbers, growing with every list a tenant adds. The count belongs to the
 * detail below, for one group, and the notice says which.
 */
export const ApprovalGroupsSection = ({
  t,
  language,
  groups,
  total,
}: SectionProps & {
  readonly groups: readonly ApprovalGroupView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="approvalGroups"
    total={total}
    shown={groups.length}
    note="workflow.notice.groupIsExplicitList"
  >
    {groups.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['code', 'name', 'approvalGroupId', 'version']}>
        {groups.map((group) => (
          <tr key={group.approvalGroupId}>
            {/* A tenant's own code, printed and never translated. */}
            <td>{group.code}</td>
            <td>{named(group.name, language)}</td>
            <td>{short(group.approvalGroupId)}</td>
            <td>{count(group.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * One list with the memberships on it, in the order the API returned them.
 *
 * The count shown is `members.length` — and that is not a screen computing a total, because this
 * *is* the whole list: the detail endpoint returns every membership on the group rather than a page
 * of them. A listing's `total` and a detail's list are different things and this screen keeps them
 * apart everywhere else.
 *
 * **Nothing here reaches an approval already running.** A group changed today does not change who
 * was asked yesterday: an approval snapshots its approvers when it starts. The notice says so,
 * because a reader looking at a list and at a running approval side by side would otherwise expect
 * them to agree.
 */
export const GroupMembersSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: ApprovalGroupDetailView | undefined }): ReactNode => (
  <Section t={t} title="groupMembers" note="workflow.notice.groupListingIsNotCounted">
    {detail === undefined ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Detail t={t} label="code" value={detail.group.code} />
          <Detail t={t} label="name" value={named(detail.group.name, language)} />
          <Detail t={t} label="memberCount" value={count(detail.members.length)} />
          <Detail t={t} label="version" value={count(detail.group.version)} />
        </dl>

        {detail.members.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table t={t} headers={['membershipId', 'addedOn']}>
            {detail.members.map((entry) => (
              <tr key={entry.approvalGroupMemberId}>
                {/* In full: two memberships on one list must never render as one person. */}
                <td>{member(entry.membershipId)}</td>
                <td>{instant(entry.addedOn, language)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-xs opacity-60">{t('workflow.notice.groupIsSnapshotted')}</p>
      </>
    )}
  </Section>
);

/** A labelled value, as text. Separate from `Figure` because these are strings, not counts. */
const Detail = ({
  t,
  label,
  value,
}: {
  readonly t: SectionProps['t'];
  readonly label: string;
  readonly value: string;
}): ReactNode => (
  <div className="flex flex-col">
    <dt className="opacity-70">{t(`workflow.label.${label}`)}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);
