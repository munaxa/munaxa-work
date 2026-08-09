import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type { OnboardingView, PlanView, TaskView } from '@work/onboarding/contracts';

import { textIn, type Language } from './locale';
import type { AwaitingEmployment } from './api';

/**
 * The sections of the onboarding screen, one component each.
 *
 * Split from the page so neither outgrows the size and complexity budgets the standards set — and
 * because each answers a different question, which is exactly the seam a reader wants.
 *
 * Four things this screen does deliberately:
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked. Rendering a truncated
 * identifier is honest; caching a name here would be a second answer that goes stale on the first
 * correction.
 *
 * **It shows what is waiting to be reconciled.** The awaiting count is the one number on this page
 * that reveals a *failure*: an employment with no onboarding is usually a hire event that was never
 * delivered. Showing it turns a silent gap into something somebody can act on.
 *
 * **It shows overdue as a list, not a badge.** Overdue is computed from a due date when the question
 * is asked; there is no stored flag and nothing sweeps one.
 *
 * **It says what Onboarding does not hold** — so a customer's administrator learns that no
 * employment fact lives here and that a document task holds a reference rather than a file, instead
 * of concluding a field is missing.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
const short = (id: string | undefined): string => (id === undefined ? '—' : `${id.slice(0, 8)}…`);

export const OnboardingsSection = ({
  t,
  onboardings,
  unavailable,
}: SectionProps & {
  readonly onboardings: readonly OnboardingView[];
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('onboarding.label.joiners')}</h2>

    {unavailable ? (
      <p className="text-sm opacity-70">{t('onboarding.label.unavailable')}</p>
    ) : onboardings.length === 0 ? (
      <p className="text-sm opacity-70">{t('onboarding.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {onboardings.map((onboarding) => (
          <li key={onboarding.onboardingId} className="flex flex-wrap gap-3">
            <span className="font-medium">{short(onboarding.employmentId)}</span>
            <span className="opacity-70">{t(`onboarding.state.${onboarding.state}`)}</span>
            <span className="opacity-70">
              {t('onboarding.label.plannedStart')}: {onboarding.plannedStartOn}
            </span>
            <span className="opacity-50">
              {onboarding.planVersionId === undefined
                ? t('onboarding.label.noPlan')
                : `${t('onboarding.label.version')}: ${short(onboarding.planVersionId)}`}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/**
 * The plans a tenant has configured — and the empty state that says this product ships none.
 *
 * That sentence is the section's reason to exist. A blank list would read as a page that failed to
 * load; what it actually means is that what a joiner is asked to do is the customer's decision, and
 * in several of this product's markets part of it is statutory and belongs to a country pack (00B).
 */
export const PlansSection = ({
  t,
  language,
  plans,
}: SectionProps & { readonly plans: readonly PlanView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('onboarding.label.plans')}</h2>

    {plans.length === 0 ? (
      <p className="text-sm opacity-70">{t('onboarding.label.noPlansConfigured')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {plans.map((plan) => (
          <li key={plan.planId} className="flex flex-wrap gap-3">
            <span className="font-medium">{textIn(plan.name, language)}</span>
            <span className="opacity-70">{t(`onboarding.planStatus.${plan.status}`)}</span>
            <span className="opacity-50">{plan.code}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const OverdueSection = ({
  t,
  language,
  overdue,
}: SectionProps & { readonly overdue: readonly TaskView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('onboarding.label.overdue')}</h2>

    {overdue.length === 0 ? (
      <p className="text-sm opacity-70">{t('onboarding.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {overdue.map((task) => (
          <li key={task.taskId} className="flex flex-wrap gap-3">
            <span className="font-medium">{textIn(task.title, language)}</span>
            <span className="opacity-70">{t(`onboarding.ownerKind.${task.ownerKind}`)}</span>
            <span className="opacity-70">
              {t('onboarding.label.dueOn')}: {task.dueOn ?? '—'}
            </span>
            <span className="opacity-50">{t(`onboarding.taskStatus.${task.status}`)}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/**
 * Employments with no onboarding, and the sentence that explains why the list can be non-empty.
 *
 * This is the reliability story made visible: an onboarding is never guaranteed by a hire event, and
 * this is where a gap shows up before somebody's first day rather than after it.
 */
export const AwaitingSection = ({
  t,
  awaiting,
}: SectionProps & { readonly awaiting: readonly AwaitingEmployment[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('onboarding.label.awaiting')}</h2>
    <p className="text-sm opacity-70">{t('onboarding.label.eventLimitation')}</p>

    {awaiting.length === 0 ? (
      <p className="text-sm opacity-70">{t('onboarding.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {awaiting.map((employment) => (
          <li key={employment.employmentId} className="flex flex-wrap gap-3">
            <span className="font-medium">{short(employment.employmentId)}</span>
            <span className="opacity-50">{employment.startDate}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-medium">{t('onboarding.label.boundaries')}</h2>
    <ul className="flex flex-col gap-1 text-sm opacity-80">
      <li>{t('onboarding.label.boundaryEmployment')}</li>
      <li>{t('onboarding.label.boundaryIdentity')}</li>
      <li>{t('onboarding.label.boundaryDocuments')}</li>
      <li>{t('onboarding.label.boundaryMessaging')}</li>
    </ul>
  </Card>
);
