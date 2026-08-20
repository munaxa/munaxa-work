import type { ReactNode } from 'react';

import { count } from './exact';
import { Figure, Section, type SectionProps } from './sections';

/**
 * Five figures, and every one of them is a number the server counted.
 *
 * **Nothing here is computed.** Each figure is a `total` the API returned over its own predicate:
 * how many workflows this tenant has configured, how many lists of approvers it keeps, how many
 * approvals exist, how many steps are waiting on the caller, and how many decisions the caller has
 * made. None is a length of a page, and none is derived from another.
 *
 * **There is no figure here about a branch or a tally, and there could not be.** A tally belongs to
 * one approval and is computed from its own decisions; a figure counting approvals "awaiting a
 * majority" across a tenant would be an aggregate no endpoint answers and this screen would have to
 * invent by reading every approval. The branch section shows the tallies of the one approval it
 * read.
 *
 * **There is no metric on this page and there is not going to be one.** No success rate, no average
 * approval time, no bottleneck, no SLA compliance, no escalation rate. Every one of those is a
 * calculation over instants this module publishes but does not measure, and a dashboard figure is
 * indistinguishable from a fact once it is on a screen. The status section says so in words.
 *
 * When the service does not answer, this says so. An outage rendered as four zeroes is a screen
 * telling an administrator their organization approves nothing.
 */
export const OverviewSection = ({
  t,
  groupsTotal,
  definitionsTotal,
  instancesTotal,
  pendingTotal,
  decidedTotal,
  unavailable,
}: SectionProps & {
  readonly groupsTotal: number;
  readonly definitionsTotal: number;
  readonly instancesTotal: number;
  readonly pendingTotal: number;
  readonly decidedTotal: number;
  readonly unavailable: boolean;
}): ReactNode => (
  <Section t={t} title="overview">
    {unavailable ? (
      <p className="text-sm opacity-70">{t('workflow.notice.failed')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
        <Figure t={t} label="definitionsTotal" value={count(definitionsTotal)} />
        <Figure t={t} label="groupsTotal" value={count(groupsTotal)} />
        <Figure t={t} label="instancesTotal" value={count(instancesTotal)} />
        <Figure t={t} label="pendingTotal" value={count(pendingTotal)} />
        <Figure t={t} label="decidedTotal" value={count(decidedTotal)} />
      </dl>
    )}
    <p className="text-xs opacity-60">{t('workflow.notice.queueIsAmbient')}</p>
  </Section>
);
