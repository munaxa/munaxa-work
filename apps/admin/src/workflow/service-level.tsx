import type { ReactNode } from 'react';
import type { WorkflowStepTemplateView, WorkflowStepView } from '@work/workflow/contracts';

import { count, instant } from './exact';
import { Term, type SectionProps } from './sections';
import type { Language } from './locale';

/**
 * How long a step was expected to take, and how it stands against that — every value the server's.
 *
 * **There is no arithmetic in this file, and that is the whole of its design.** No division, no
 * multiplication, no `Math.`, no `toFixed`, no percentage, no comparison of two instants and no
 * reading of any clock. `dueOn` is not `awaitingOn` plus the target: it is a field the application
 * computed and published, and recomputing it here would be a second answer that disagrees with the
 * first the day either changes. The state is not derived from whether `dueOn` is in the past — it is
 * the application's own word, worked out against a reading instant this screen never sees.
 *
 * That is also why there is **no progress bar**. A bar is elapsed-over-target rendered as a shape,
 * and the division is the part that does not belong on a screen — the same rule the branch tally is
 * held to, for the same reason.
 *
 * **A target is a target and not a deadline.** Nothing fires when it passes, so there is no
 * countdown, no timer, no colour that changes on its own and no `expired`. `expired` is declared in
 * the approval vocabulary and this product never produces it; the state vocabulary rendered here has
 * exactly three values, and a screen that offered a fourth would be showing an operational state
 * nothing can reach.
 *
 * **The two shapes are taken from the views themselves** rather than named as separate types. A
 * template's target and a running step's are published as fields on `WorkflowStepTemplateView` and
 * `WorkflowStepView`, and reading them off those views is what guarantees this file renders the
 * shape the API actually sends rather than one that happens to resemble it.
 *
 * **The unit is shown as it was configured.** `48 hours` is not turned into `2 days`: they are the
 * same length of time and not the same sentence, and the one an administrator typed is the one they
 * must be shown back.
 */

type TargetView = WorkflowStepTemplateView['serviceLevel'];
type StepLevelView = WorkflowStepView['serviceLevel'];

/**
 * A configured target, as a count and its unit — the shape a **template** carries.
 *
 * Two rendered values rather than one composed string, because composing "2 days" in code would mean
 * choosing a word order, and the two languages this product speaks do not share one. The count goes
 * through `count`, so four thousand hours reads as `4000` in both rather than picking up a thousands
 * separator in one and Arabic-Indic digits in the other.
 */
export const Target = ({
  t,
  target,
}: {
  readonly t: SectionProps['t'];
  readonly target: TargetView;
}): ReactNode => {
  if (target === undefined) return <span>—</span>;

  return (
    <span className="whitespace-nowrap">
      {count(target.count)} <Term t={t} group="serviceLevelUnit" value={target.unit} />
    </span>
  );
};

/**
 * The same target on a **running** step, where the server also says how it stands.
 *
 * The three cells below are three separate published fields and never one derived from another:
 * `state` is the application's word, `dueOn` its computed instant, and `overdueByMinutes` its whole
 * number of minutes — absent while the step is within its target rather than rendered as a zero,
 * because "not overdue" and "overdue by none" are different sentences.
 */
export const StepServiceLevel = ({
  t,
  language,
  level,
}: {
  readonly t: SectionProps['t'];
  readonly language: Language;
  readonly level: StepLevelView;
}): ReactNode => {
  if (level === undefined) return <span>—</span>;

  return (
    <span className="whitespace-nowrap">
      {count(level.count)} <Term t={t} group="serviceLevelUnit" value={level.unit} />
      {' · '}
      <Term t={t} group="serviceLevelState" value={level.state} />
      {/* The instant the application computed, rendered by the same UTC-pinned formatter every other
          instant on this screen goes through. Never `awaitingOn` plus anything. */}
      {' · '}
      {instant(level.dueOn, language)}
      {/* Whole minutes, exactly as published: never divided into hours, never rounded, never a
          percentage of the target. */}
      {' · '}
      {count(level.overdueByMinutes)}
    </span>
  );
};

/** Just the state, for a listing that has room for one cell rather than four. */
export const ServiceLevelState = ({
  t,
  level,
}: {
  readonly t: SectionProps['t'];
  readonly level: StepLevelView;
}): ReactNode =>
  level === undefined ? (
    <span>—</span>
  ) : (
    <Term t={t} group="serviceLevelState" value={level.state} />
  );
