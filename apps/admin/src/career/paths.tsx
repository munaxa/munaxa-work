import type { ReactNode } from 'react';
import type { CareerPathDetailView, CareerPathView, CareerPlanView } from '@work/career/contracts';

import { civil, count } from './exact';
import { pathActionsFor, planActionsFor } from './lifecycle';
import {
  Actions,
  AsOf,
  Empty,
  Section,
  Status,
  Table,
  named,
  short,
  yesNo,
  type SectionProps,
} from './sections';

/**
 * The ladders a tenant defined, the rungs on one of them, and the individual plans against them.
 *
 * **A stage's sequence is an order, not a gate** (D-17). Nothing enforces progression: a plan may
 * target stage four without having passed through two and three, and this screen neither warns about
 * that nor implies it is wrong. Prerequisites were never specified, and a screen that flagged one
 * would be enforcing a rule nobody wrote.
 *
 * **A stage may name a position, and nothing else about it is shown.** The identifier is what Career
 * stores — no title, no grade, and above all no criticality (AD-004). A screen that captioned it
 * "critical position" would be asserting a fact Career has no way to obtain (D-4).
 *
 * **`inForce` is the server's answer.** A path effective from next quarter is configuration somebody
 * has already written down and is not yet something a plan may be created against — and which of
 * those it is depends on the day, which the API states and this screen prints.
 */

export const PathsSection = ({
  t,
  language,
  paths,
  total,
}: SectionProps & {
  readonly paths: readonly CareerPathView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="paths" total={total} shown={paths.length}>
    {paths.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'code',
          'name',
          'kind',
          'status',
          'effectiveFrom',
          'effectiveTo',
          'inForce',
          'stageCount',
          'version',
        ]}
      >
        {paths.map((path) => (
          <tr key={path.pathId}>
            <td>{path.code}</td>
            <td>{named(path.name, language)}</td>
            <td>
              <Status t={t} group="careerPathKind" status={path.kind} />
            </td>
            <td>
              <Status t={t} group="careerPathStatus" status={path.status} />
            </td>
            {/* Civil dates, exactly as the domain stored them. No `Date` on this path. */}
            <td>{civil(path.effectiveFrom)}</td>
            <td>{civil(path.effectiveTo)}</td>
            {/* Derived by the server against the day it reports. Never recomputed here. */}
            <td>{yesNo(path.inForce, t)}</td>
            <td>{count(path.stageCount)}</td>
            <td>{count(path.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * The stages of one path, in sequence.
 *
 * One path, for the first row of the listing above — never one request per path. The note says so,
 * because a reader who assumed every path's stages were on the page would draw conclusions from an
 * absence that is a request budget rather than a fact about the tenant.
 */
export const StagesSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: CareerPathDetailView | undefined }): ReactNode => (
  <Section t={t} title="stages" note="career.notice.detailIsFirstRow">
    {detail === undefined || detail.stages.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['sequence', 'name', 'targetPosition']}>
          {detail.stages.map((stage) => (
            <tr key={stage.stageId}>
              {/* An ordinal a human chose. `String`, never `toLocaleString` — see `exact.ts`. */}
              <td>{count(stage.sequence)}</td>
              <td>{named(stage.name, language)}</td>
              {/* An identifier the tenant named. Nothing here says it is a critical position. */}
              <td>{short(stage.targetPositionId)}</td>
            </tr>
          ))}
        </Table>
        <AsOf t={t} asOf={detail.asOf} />
        <Actions t={t} actions={pathActionsFor(detail.path)} />
        <p className="text-xs opacity-60">{t('career.notice.positionsAreReferences')}</p>
      </>
    )}
  </Section>
);

/**
 * The individual plans: who is on a ladder, where they are on it, and where they are going.
 *
 * **The employment is a subject and never an identity.** This is an administrator's listing of the
 * tenant's plans, scoped by what the caller holds. It is not "my career", there is no route for one,
 * and the employment column is an identifier rather than a name because resolving it is People's
 * read behind People's permission.
 *
 * The development linkage the API carries is the *plan's* own `careerPlanId` on a development plan,
 * not a field on this row — so what is shown here is what a career plan actually holds, and the
 * development workspace below shows the other side of the link.
 */
export const PlansSection = ({
  t,
  plans,
  total,
}: SectionProps & {
  readonly plans: readonly CareerPlanView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="plans"
    total={total}
    shown={plans.length}
    note="career.notice.identifiersNotNames"
  >
    {plans.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'employment',
          'paths',
          'targetStage',
          'status',
          'startedOn',
          'targetDate',
          'version',
        ]}
      >
        {plans.map((plan) => (
          <tr key={plan.careerPlanId}>
            <td>{short(plan.employmentId)}</td>
            <td>{short(plan.pathId)}</td>
            <td>{short(plan.targetStageId)}</td>
            <td>
              <Status t={t} group="careerPlanStatus" status={plan.status} />
            </td>
            <td>{civil(plan.startedOn)}</td>
            <td>{civil(plan.targetDate)}</td>
            <td>{count(plan.version)}</td>
          </tr>
        ))}
      </Table>
    )}
    <Actions t={t} actions={planActionsFor(plans[0])} />
  </Section>
);
