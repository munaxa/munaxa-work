import { uuidV7, type EventOrigin } from '@work/kernel';

import { EmploymentEvents } from './employment-events.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import type { ReportingLineType } from './employment-vocabulary.js';

/**
 * Who an employment reported to, and from when.
 *
 * **A manager is an employment, not a second identity** (§16). That is the decision worth reading
 * twice: the alternative — a `managerId` pointing at a person, or worse a `Manager` entity — makes
 * "who was this person's manager in March" unanswerable the moment the manager themselves changes
 * jobs, because a person is not a role and a role is not a person.
 *
 * Pointing at an employment also means a manager's own departure is already modelled: their
 * employment ends, and every line naming it is historical rather than dangling.
 *
 * Manager Self-Service (Phase 19) is what eventually consumes this. Nothing here implements it,
 * and nothing here decides what a manager may *do* — that is authorization, and authorization is
 * Platform's.
 */

export interface ReportingLineState extends VersionedChildState {
  readonly managerEmploymentId: string;
  readonly lineType: ReportingLineType;
}

export interface CreateReportingLine {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly managerEmploymentId: string;
  readonly lineType: ReportingLineType;
  readonly effectiveFrom: Date;
}

export class ReportingLine extends VersionedChild<ReportingLineState> {
  private constructor(state: ReportingLineState) {
    super(state, 'ReportingLine', EmploymentEvents.reportingLineClosed);
  }

  public static create(
    request: CreateReportingLine,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<ReportingLine> {
    if (request.managerEmploymentId === request.employmentId) {
      return refuse('manager_cannot_be_self');
    }

    const line = new ReportingLine({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      employmentId: request.employmentId,
      managerEmploymentId: request.managerEmploymentId,
      lineType: request.lineType,
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    line.raise(
      EmploymentEvents.managerChanged,
      {
        reportingLineId: line.id,
        employmentId: request.employmentId,
        managerEmploymentId: request.managerEmploymentId,
        lineType: request.lineType,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(line);
  }

  public static rehydrate(state: ReportingLineState): ReportingLine {
    return new ReportingLine(state);
  }

  public get managerEmploymentId(): string {
    return this.state.managerEmploymentId;
  }

  public get lineType(): ReportingLineType {
    return this.state.lineType;
  }
}

/**
 * Whether making `manager` the manager of `employment` would close a loop.
 *
 * A cycle is not a theoretical concern: it is what happens when two people are promoted into each
 * other's chain during a reorganization, and the symptom is an escalation that never terminates or
 * a manager hierarchy screen that hangs. The database catches the length-one case with a check
 * constraint; longer ones need a walk, and a walk is a domain rule rather than a constraint.
 *
 * The walk is **bounded** rather than trusting the data to be acyclic — if the graph already
 * contains a cycle from some earlier state, an unbounded walk would hang here instead of
 * reporting it, which turns a data problem into an outage.
 */
export const wouldCloseALoop = (
  employmentId: string,
  managerEmploymentId: string,
  managerOf: ReadonlyMap<string, string>,
): boolean => {
  const visited = new Set<string>();
  let current: string | undefined = managerEmploymentId;

  while (current !== undefined) {
    if (current === employmentId) return true;
    // Revisiting a node means the *existing* graph already contains a cycle. Reporting it as a
    // loop is right, and it is also what stops this walk running forever on data that is already
    // wrong — the failure mode an unbounded walk turns into an outage.
    if (visited.has(current)) return true;
    visited.add(current);
    current = managerOf.get(current);
  }
  return false;
};
