import type { ReactNode } from 'react';

import { Section, type SectionProps } from './sections';

/**
 * What this product does not do, said once and plainly.
 *
 * A screen that simply lacked these would read as an unfinished screen. Naming them is the
 * difference between a missing dependency and a bug — and it stops a later reader from building a
 * control, a report or a decision on top of a capability that is not there.
 *
 * Each entry is a **documented absence**, not a feature waiting to be switched on, and none of them
 * has a placeholder success state anywhere on this page: there is no due date rendered as "—" beside
 * a heading called service level, no escalation column, no tally, no notification bell and no
 * "coming soon" control that implies something is nearly here.
 *
 * Four are worth the words even though something adjacent does exist:
 *
 * - The approval vocabulary declares **`expired`** and nothing in this phase produces it. The
 *   mapping is total so a reader can see the gap; the gap is not an operational state.
 * - A **delegation** is real and Identity owns it. Nothing expires one on a timer — whether one is
 *   in force is asked at the instant a decision is made.
 * - Every approval carries **instants**, and no service level is measured against any of them.
 *   Publishing a time is not measuring one.
 * - A decision reaches the module that raised the approval **inside the approver's own request**.
 *   That is a seam, not a queue: there is no outbox, no broker and no callback.
 *
 * The list is written against the module's own catalogue, so the wording is the module's rather than
 * the portal's, and the Arabic is gated by `check-localization` alongside the English.
 */

/**
 * The seventeen absences the module states, plus the three this screen adds for itself.
 *
 * The first seventeen are the module's own `workflow.withheld.*` catalogue. The last three are
 * portal-level facts: this Admin app has no mutation architecture, resolves no identifier to a name,
 * and never asks whose queue it is looking at.
 */
const NOT_VERIFIED = [
  'workflow.withheld.sla',
  'workflow.withheld.businessDays',
  'workflow.withheld.escalation',
  'workflow.withheld.scheduling',
  'workflow.withheld.approvalExpiry',
  'workflow.withheld.delegationExpiry',
  'workflow.withheld.parallelApproval',
  'workflow.withheld.tally',
  'workflow.withheld.conditionalBranching',
  'workflow.withheld.roles',
  'workflow.withheld.groups',
  'workflow.withheld.managerRouting',
  'workflow.withheld.externalApprovers',
  'workflow.withheld.notificationDelivery',
  'workflow.withheld.analytics',
  'workflow.withheld.asynchronousCallbacks',
  'workflow.withheld.outbox',
] as const;

const PORTAL = [
  'workflow.notice.actionsAreApi',
  'workflow.notice.identifiersNotNames',
  'workflow.notice.queueIsAmbient',
] as const;

export const StatusSection = ({ t }: SectionProps): ReactNode => (
  <Section t={t} title="statusNotices">
    <ul className="flex flex-col gap-2 text-sm">
      {[...NOT_VERIFIED, ...PORTAL].map((key) => (
        <li key={key} className="opacity-70">
          {t(key)}
        </li>
      ))}
    </ul>
  </Section>
);
