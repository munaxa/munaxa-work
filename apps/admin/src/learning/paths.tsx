import type { ReactNode } from 'react';
import type { PathDetailView, PathView } from '@work/learning/contracts';

import { count } from './exact';
import { pathActionsFor, pathWithheldBecause } from './lifecycle';
import {
  Actions,
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
 * Learning paths: an ordered set of courses a tenant groups together.
 *
 * **A step's position is an order, not a gate.** Nothing in this product enforces a prerequisite —
 * prerequisites were never specified, and enforcing an unspecified one would block real people from
 * real training on a rule nobody wrote. So the column is headed "position" rather than "step", and
 * there is no progress bar implying somebody must finish one before starting the next.
 *
 * **There is no per-path progress figure, because the API exposes none.** A path's steps and a
 * person's assignments are separate rows joined by nothing the read contract returns, and computing
 * a completion percentage here would mean either a request per step or arithmetic over an
 * unrelated page. The assignment queue is where a person's actual position is visible.
 *
 * Publication and archival are named where the state allows them, and the API decides.
 */

export const PathsSection = ({
  t,
  language,
  paths,
  total,
}: SectionProps & {
  readonly paths: readonly PathView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="paths" total={total} shown={paths.length}>
    {paths.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['code', 'title', 'kind', 'status', 'steps', 'version']}>
          {paths.map((path) => (
            <tr key={path.pathId}>
              <td>{path.code}</td>
              <td>{named(path.name, language)}</td>
              <td>
                <Status t={t} group="pathKind" status={path.kind} />
              </td>
              <td>
                <Status t={t} group="pathStatus" status={path.status} />
              </td>
              <td>{count(path.stepCount)}</td>
              <td>{count(path.version)}</td>
            </tr>
          ))}
        </Table>

        <Actions
          t={t}
          actions={pathActionsFor(paths[0])}
          withheld={pathWithheldBecause(paths[0])}
        />
      </>
    )}
  </Section>
);

/**
 * One path's steps, in sequence.
 *
 * The first path in the listing, in one request — never one per path. A course is shown by its
 * identifier: resolving it to a title would be a request per step, which is the amplification this
 * screen is written to avoid.
 */
export const StepsSection = ({
  t,
  path,
}: SectionProps & { readonly path: PathDetailView | undefined }): ReactNode => (
  <Section t={t} title="steps" note="learning.notice.sequenceIsNotAPrerequisite">
    {path === undefined || path.steps.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['sequence', 'course', 'optional']}>
        {path.steps.map((step) => (
          <tr key={step.stepId}>
            <td>{count(step.sequence)}</td>
            <td>{short(step.courseId)}</td>
            <td>{yesNo(step.optional, t)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
