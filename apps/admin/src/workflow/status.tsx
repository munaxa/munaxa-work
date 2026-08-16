import type { ReactNode } from 'react';

import { Section, type SectionProps } from './sections';

/**
 * What this product does not do, said once and plainly — and what it now does.
 *
 * A screen that simply lacked these would read as an unfinished screen. Naming them is the
 * difference between a missing dependency and a bug — and it stops a later reader from building a
 * control, a report or a decision on top of a capability that is not there.
 *
 * **The list is only honest if it shrinks when the product grows.** Phase 16B built parallel
 * branches, the three branch rules, the quorum, conditions, the tally and approval groups, and every
 * one of those was on this list in Phase 16A. Leaving them here would be the same dishonesty in the
 * other direction — telling an administrator this product cannot ask two people at once, on a page
 * that is rendering a branch doing exactly that. They have moved to the section above, and the two
 * entries that stayed were rewritten rather than deleted, because what is absent is narrower than
 * what was absent: there is no role directory and no **group** directory, while an approval group —
 * an explicit list a tenant writes down — is real.
 *
 * Each remaining entry is a **documented absence**, not a feature waiting to be switched on, and
 * none of them has a placeholder success state anywhere on this page: there is no due date rendered
 * as "—" beside a heading called service level, no escalation column, no notification bell and no
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
 * The six capabilities this phase added, the seventeen absences the module still states, and the
 * three portal-level facts this screen adds for itself.
 *
 * The absences are the module's own `workflow.withheld.*` catalogue. The last three are the portal's
 * own: this Admin app has no mutation architecture, resolves no identifier to a name, and never asks
 * whose queue it is looking at.
 */
const PROVIDED = [
  'workflow.provided.approvalGroups',
  'workflow.provided.parallelApproval',
  'workflow.provided.branchRules',
  'workflow.provided.quorum',
  'workflow.provided.conditionalBranching',
  'workflow.provided.tally',
] as const;

const NOT_VERIFIED = [
  'workflow.withheld.sla',
  'workflow.withheld.businessDays',
  'workflow.withheld.escalation',
  'workflow.withheld.scheduling',
  'workflow.withheld.approvalExpiry',
  'workflow.withheld.delegationExpiry',
  'workflow.withheld.delegationManagement',
  'workflow.withheld.roles',
  'workflow.withheld.groupDirectory',
  'workflow.withheld.managerRouting',
  'workflow.withheld.externalApprovers',
  'workflow.withheld.notificationDelivery',
  'workflow.withheld.analytics',
  'workflow.withheld.asynchronousCallbacks',
  'workflow.withheld.outbox',
  'workflow.withheld.routingIntelligence',
  'workflow.withheld.selfServicePortal',
] as const;

const PORTAL = [
  'workflow.notice.actionsAreApi',
  'workflow.notice.identifiersNotNames',
  'workflow.notice.queueIsAmbient',
] as const;

/**
 * What this release added, said before what it still does not do.
 *
 * Six of the capabilities the previous phase named as absent are now real, and leaving them on the
 * list below would be the same failure in the other direction: a screen that told an administrator
 * this product cannot run two approvers at once, on a page rendering a branch that does.
 */
export const ProvidedSection = ({ t }: SectionProps): ReactNode => (
  <Section t={t} title="providedNotices">
    <ul className="flex flex-col gap-2 text-sm">
      {PROVIDED.map((key) => (
        <li key={key} className="opacity-70">
          {t(key)}
        </li>
      ))}
    </ul>
  </Section>
);

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
