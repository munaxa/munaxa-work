import type { ReactNode } from 'react';
import type { WorkflowHistoryView } from '@work/workflow/contracts';

import { count, instant, member } from './exact';
import { Empty, Section, Table, Term, type SectionProps } from './sections';

/**
 * One approval's timeline, in the order the API returned it.
 *
 * **Nothing is sorted, grouped or re-stamped here.** The API returns the entries oldest first, and
 * this renders them in that order; a screen that sorted by its own reading of `occurredOn` would be
 * a second answer to the ordering question, and one that disagreed whenever two entries shared a
 * millisecond. The instants are the server's own, pinned to UTC so the moment survives.
 *
 * **Nothing is added to an entry.** The timeline records **routing** — who was asked, who answered,
 * on whose authority, and when. It carries no comment and this screen does not fetch one: a
 * rejection comment lives on the decision, where a permission decides who may read it, and moving it
 * here would put one person's written opinion of another's request into a list a queue screen
 * renders. It carries no business outcome either; "the requisition was approved" is Recruitment's
 * sentence, and this module never writes it.
 */
export const HistorySection = ({
  t,
  language,
  history,
  total,
}: SectionProps & {
  readonly history: readonly WorkflowHistoryView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="history"
    total={total}
    shown={history.length}
    note="workflow.notice.historyIsRouting"
  >
    {history.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['occurredOn', 'event', 'ordinal', 'actor', 'onBehalfOf']}>
        {history.map((entry) => (
          <tr key={entry.historyId}>
            <td>{instant(entry.occurredOn, language)}</td>
            <td>
              <Term t={t} group="historyEvent" value={entry.event} />
            </td>
            <td>{count(entry.ordinal)}</td>
            {/* Who acted, and whose authority they used. Both are the API's own fields, and an
                entry that names neither — an approval starting, a step becoming current — renders
                as absent rather than being attributed to somebody. */}
            <td>{member(entry.actorMembershipId)}</td>
            <td>{member(entry.onBehalfOfMembershipId)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
