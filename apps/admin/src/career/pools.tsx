import type { ReactNode } from 'react';
import type { PoolMembershipView, TalentPoolView } from '@work/career/contracts';

import { civil, count } from './exact';
import { poolActionsFor } from './lifecycle';
import {
  Actions,
  Empty,
  Section,
  Status,
  Table,
  named,
  short,
  type SectionProps,
} from './sections';

/**
 * The talent pools a tenant maintains, and who an organization decided belongs in one.
 *
 * **A pool membership is a decision, not an observation** (ADR-0073). Nothing on this screen reads a
 * nine-box placement, a potential band or a performance rating, and nothing infers one: being in a
 * pool called "high potential" is a standing decision somebody took and recorded, and it is not
 * evidence about anybody's performance. Deriving one from the other would put a judgement nobody
 * made beside a person's name.
 *
 * **A membership has two ends and neither is a deletion.** "This person was in the leadership pool
 * from April to October" is the fact a succession review needs a year later, so a closed membership
 * keeps both dates and the reasons somebody wrote for each end.
 *
 * **Closing a pool does not close its history.** Who was in it stays readable, which is what makes
 * the closed state safe to use.
 */

export const PoolsSection = ({
  t,
  language,
  pools,
  total,
}: SectionProps & {
  readonly pools: readonly TalentPoolView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="pools" total={total} shown={pools.length}>
    {pools.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['code', 'name', 'kind', 'status', 'version']}>
          {pools.map((pool) => (
            <tr key={pool.talentPoolId}>
              <td>{pool.code}</td>
              <td>{named(pool.name, language)}</td>
              <td>
                <Status t={t} group="talentPoolKind" status={pool.kind} />
              </td>
              <td>
                <Status t={t} group="talentPoolStatus" status={pool.status} />
              </td>
              <td>{count(pool.version)}</td>
            </tr>
          ))}
        </Table>
        <Actions t={t} actions={poolActionsFor(pools[0])} />
      </>
    )}
  </Section>
);

/**
 * Who was in a pool, and for how long.
 *
 * The effective period is shown as the two civil dates the domain stored, not as a duration and not
 * as a computed "current" flag: whether a membership is in force depends on the day being asked
 * about, and the API answers that question when it is asked with one. A screen that painted an open
 * membership green because `to` was absent would be right until somebody backdated an end.
 */
export const MembershipsSection = ({
  t,
  memberships,
  total,
}: SectionProps & {
  readonly memberships: readonly PoolMembershipView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="memberships"
    total={total}
    shown={memberships.length}
    note="career.notice.identifiersNotNames"
  >
    {memberships.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['employment', 'pools', 'from', 'to', 'addedBy', 'version']}>
        {memberships.map((membership) => (
          <tr key={membership.membershipId}>
            <td>{short(membership.employmentId)}</td>
            <td>{short(membership.talentPoolId)}</td>
            {/* Both ends are civil dates, rendered exactly as stored. */}
            <td>{civil(membership.from)}</td>
            <td>{civil(membership.to)}</td>
            <td>{membership.addedBy}</td>
            <td>{count(membership.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
