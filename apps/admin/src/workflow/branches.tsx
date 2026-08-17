import type { ReactNode } from 'react';
import type {
  BranchConditionView,
  BranchTallyView,
  WorkflowStepView,
} from '@work/workflow/contracts';

import { count, member, short } from './exact';
import { ServiceLevelState } from './service-level';
import { Empty, Section, Table, Term, type SectionProps } from './sections';

/**
 * How a branch stands, and what it takes — every number of it the server's.
 *
 * **Nothing on this screen is arithmetic.** `assigned`, `approvals`, `rejections`, `responses`,
 * `outstanding`, `threshold` and `quorum` arrive as whole numbers the application computed from the
 * decisions that exist, and each is rendered exactly as it came. This file contains no addition, no
 * subtraction, no division, no comparison and no percentage — which is the same rule the API
 * controllers were held to in Checkpoint 6, for the same reason: a second implementation of "how
 * many approvals does this need" is a second answer, and it disagrees with the first the day either
 * one changes.
 *
 * That is why there is no progress bar here. A bar is `approvals / threshold` rendered as a shape,
 * and the division is the part that does not belong on a screen.
 *
 * **A branch is one position with several people in it.** Two approvers sharing an ordinal are asked
 * at the same moment, and both of their steps are awaiting at once — so the awaiting section below
 * is a table rather than a single row, and a decision already recorded is shown as the decision it
 * is and never as a step that was skipped.
 */

/** One row per branch, in the order the API returned them. */
export const BranchesSection = ({
  t,
  tallies,
}: SectionProps & { readonly tallies: readonly BranchTallyView[] }): ReactNode => (
  <Section t={t} title="branches" note="workflow.notice.tallyIsServerComputed">
    {tallies.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'ordinal',
          'branchRule',
          'assigned',
          'approvals',
          'rejections',
          'responses',
          'outstanding',
          'threshold',
          'quorum',
          'quorumMet',
          'outcome',
        ]}
      >
        {tallies.map((tally) => (
          <tr key={tally.ordinal}>
            <td>{count(tally.ordinal)}</td>
            <td>
              <Term t={t} group="branchRule" value={tally.rule} />
            </td>
            {/* The denominator the approval snapshotted. It does not move when somebody leaves a
                group: a person who has not answered is outstanding, never subtracted. */}
            <td>{count(tally.assigned)}</td>
            <td>{count(tally.approvals)}</td>
            <td>{count(tally.rejections)}</td>
            <td>{count(tally.responses)}</td>
            <td>{count(tally.outstanding)}</td>
            {/* How many approvals the rule needs. Read, never derived from the rule and the size. */}
            <td>{count(tally.threshold)}</td>
            <td>{count(tally.quorum)}</td>
            <td>
              <Term t={t} group="quorumMet" value={tally.quorumMet ? 'met' : 'not-met'} />
            </td>
            <td>
              <Term t={t} group="branchOutcome" value={tally.outcome} />
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * Every step a decision is being asked for right now — all of them, not the first.
 *
 * A branch of four has four steps awaiting at once. The contract publishes the singular `awaiting`
 * beside the plural for the shape Phase 16A had, and this screen reads the plural: rendering one of
 * four would tell an administrator that three of the people being asked are not.
 */
export const AwaitingSection = ({
  t,
  steps,
}: SectionProps & { readonly steps: readonly WorkflowStepView[] }): ReactNode => (
  <Section t={t} title="awaitingSteps" note="workflow.notice.branchIsSimultaneous">
    {steps.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'ordinal',
          'approver',
          'sourceGroup',
          'branchRule',
          'quorum',
          'serviceLevelState',
        ]}
      >
        {steps.map((step) => (
          <tr key={step.stepId}>
            <td>{count(step.ordinal)}</td>
            <td>{member(step.approverMembershipId)}</td>
            {/* Provenance: which list this person was taken from when the approval started. It
                answers "why was I asked?" and routes nothing. */}
            <td>{short(step.sourceGroupId)}</td>
            <td>
              <Term t={t} group="branchRule" value={step.branchRule} />
            </td>
            <td>{count(step.quorum)}</td>
            {/* One cell here rather than four: this table is about who is being asked, and the
                approval's own chain below carries the target, the due instant and the minutes. */}
            <td>
              <ServiceLevelState t={t} level={step.serviceLevel} />
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * The conditions a branch runs under, as configuration.
 *
 * **Nothing is evaluated here.** A condition is read by the server against the values the raising
 * request supplied, when the approval starts. This screen has no such request and no such values, so
 * it renders the clauses and stops — no true, no false, no "would run", no green tick.
 *
 * That restraint is the honest one rather than the cautious one. The server distinguishes three
 * different refusals — the request does not carry the value, the value is of a kind this comparison
 * cannot use, and the value is of a different kind from the one configured — from an ordinary "the
 * condition did not hold". A screen that printed `false` would collapse four outcomes into one, and
 * three of them are configuration mistakes somebody needs to fix rather than routing that worked.
 *
 * `all-of` is the only way clauses combine, so there is no operator between the rows and no
 * precedence to render. Every clause must hold.
 */
export const Clauses = ({
  t,
  condition,
}: {
  readonly t: SectionProps['t'];
  readonly condition: readonly BranchConditionView[] | undefined;
}): ReactNode => {
  if (condition === undefined || condition.length === 0) return <span>—</span>;

  return (
    <ul className="flex flex-col">
      {condition.map((clause) => (
        <li key={`${clause.key}-${clause.operator}`} className="whitespace-nowrap">
          {/* The key is the raising module's own word for the value it supplied, printed and never
              translated; the operator is this module's closed vocabulary and is. */}
          <span>{clause.key}</span> <Term t={t} group="conditionOperator" value={clause.operator} />{' '}
          <span>{operand(clause.value)}</span>
        </li>
      ))}
    </ul>
  );
};

/**
 * A configured operand, as text.
 *
 * A whole number goes through `count`, so a bound of four thousand reads as `4000` in both languages
 * rather than picking up a thousands separator in one and Arabic-Indic digits in the other. A list
 * is joined and never sorted: the order is the one somebody configured.
 */
const scalar = (value: string | number): string =>
  typeof value === 'number' ? count(value) : value;

const operand = (value: BranchConditionView['value']): string =>
  typeof value === 'object' ? value.map(scalar).join(', ') : scalar(value);
