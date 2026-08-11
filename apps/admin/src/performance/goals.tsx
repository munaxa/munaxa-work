import type { ReactNode } from 'react';
import type { GoalView } from '@work/performance/contracts';

import { goalActionsFor, goalWithheldBecause } from './lifecycle';
import { exactText, scoreText, weightText } from './scoring';
import {
  Actions,
  Empty,
  Section,
  Status,
  Table,
  instant,
  short,
  type SectionProps,
} from './sections';

/**
 * The goals workspace: what was set, who owns it, what it is worth and how far it has got.
 *
 * **`observedValue` is rendered exactly as it arrived, and never parsed.** It is a decimal string
 * because the underlying value is a `bigint` that can exceed 2^53 — a count of transactions, of
 * bytes, of parts — and `Number('9007199254740993')` is `9007199254740992`. A measurement that
 * rounded on the way to a screen is a measurement nobody can falsify, which is the opposite of what
 * a measurement is for. `exactText` is the identity function with a name, so a future reader
 * reaching for `Number(...)` to "format" it meets the reason instead.
 *
 * **An evidence document is an identifier and nothing else.** No filename, no size, no link and no
 * download — Performance holds none of those, because no storage adapter exists anywhere in this
 * repository.
 */

export const GoalsSection = ({
  t,
  goals,
  total,
}: SectionProps & {
  readonly goals: readonly GoalView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="goals" total={total} shown={goals.length}>
    {goals.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={['goal', 'owner', 'scope', 'weight', 'progress', 'dueDate', 'score', 'status']}
        >
          {goals.map((goal) => (
            <tr key={goal.goalId}>
              <td>{goal.title}</td>
              {/* An employment identifier. Resolving it to a name is People's read, not this one. */}
              <td>{short(goal.employmentId ?? goal.organizationUnitId)}</td>
              <td>{t(`performance.vocabulary.goalScope.${goal.scope}`)}</td>
              <td>{weightText(goal.weightBasisPoints)}</td>
              <td>{weightText(goal.progressBasisPoints)}</td>
              {/* A civil date, rendered as stored. A due date is the same date everywhere. */}
              <td>{goal.dueDate}</td>
              <td>{scoreText(goal.finalScore)}</td>
              <td>
                <Status t={t} group="goalStatus" status={goal.status} />
              </td>
            </tr>
          ))}
        </Table>

        <Actions
          t={t}
          actions={goalActionsFor(goals[0])}
          withheld={goalWithheldBecause(goals[0])}
        />
      </>
    )}
  </Section>
);

/**
 * One goal's progress history: what was recorded, when, by whom and against what measurement.
 *
 * Entries are **appended and never rewritten** — a database trigger refuses an update — so this is
 * the history of what actually happened rather than what the goal currently looks like.
 */
export const ProgressSection = ({
  t,
  language,
  goal,
}: SectionProps & { readonly goal: GoalView | undefined }): ReactNode => (
  <Section t={t} title="progress" note="performance.notice.noDocumentBytes">
    {goal === undefined || goal.progress.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'progress',
          'observedValue',
          'comment',
          'evidenceDocument',
          'recordedAt',
          'recordedBy',
        ]}
      >
        {goal.progress.map((entry) => (
          <tr key={entry.goalProgressId}>
            <td>{weightText(entry.progressBasisPoints)}</td>
            {/* The exact string the API sent. Not parsed, not reformatted, not rounded. */}
            <td className="font-mono">{exactText(entry.observedValue)}</td>
            <td>{entry.note ?? '—'}</td>
            {/* A reference. There is no link, because there is nothing to link to. */}
            <td>{short(entry.evidenceDocumentId)}</td>
            <td>{instant(entry.recordedAt, language)}</td>
            <td>{short(entry.recordedBy)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
