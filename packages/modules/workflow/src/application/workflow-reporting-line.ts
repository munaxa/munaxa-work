import type { ManagerResolution } from '../domain/manager.js';

/**
 * The second cross-module read: who the requester's manager is, on the day the approval started.
 *
 * **One method, one question, one answer.** Not "who reports to whom", not "the chain above this
 * person", not "everybody in this department" — one membership in, one manager out, and a closed set
 * of reasons there is not one. That narrowness is the whole authorization for this port's existence:
 * a general directory read is precisely the capability `PlatformPermissionChecker` says this product
 * will never build, and a port shaped like one would be its first implementation.
 *
 * **Workflow owns none of what this answers.** The employment is Employment's, the reporting line is
 * Employment's, and the membership behind the manager's employment is Identity's. This module holds
 * no reporting line, no employment identifier and no organizational fact of any kind, and it stores
 * none of the three: what it keeps is the **one membership** that came out, snapshotted onto the step
 * exactly as a group's members are, so a running approval names people rather than a hierarchy
 * (D-16C-08).
 *
 * **`asOfDate` is a civil date and it is UTC** (P-6). `resolutionDateOf` is the one function that
 * converts the approval's own `startedAt` to it, and it is the only place a conversion happens: an
 * approval raised half an hour before midnight would otherwise find one manager in Riyadh and another
 * in Los Angeles. The date is a parameter rather than something the adapter reads from a clock, for
 * the same reason every other instant in this module is: an answer that depended on when it was asked
 * could not be asserted.
 *
 * **The answer is the domain's own type, not a shape restated here.** `ManagerResolution` is where
 * the four outcomes are defined and `resolveManager` is where they are turned into an approver or a
 * refusal — so an adapter cannot invent a fifth outcome, and this file cannot drift from the rule.
 *
 * **There is no adapter for this yet, deliberately.** The Identity query it needs is authorized
 * (D-16C-04) and is a completed module's change, built and verified on its own side before Workflow
 * depends on it — Checkpoint 6, with Checkpoint 7 wiring the adapter. A fake in production
 * composition would be a manager Workflow made up, which is worse than a manager it cannot find.
 */
export interface ReportingLinePort {
  /**
   * The requester's immediate manager, one level up the primary reporting line from their primary
   * active employment (P-1 to P-4), as at a UTC civil date.
   *
   * Never throws for the ordinary absences: no primary employment, no manager on the line, and a
   * manager whose employment has no active membership are each a **named outcome** rather than an
   * error, because each is a different person's mistake to fix and the approver is told which.
   */
  managerOf(requesterMembershipId: string, asOfDate: string): Promise<ManagerResolution>;
}
