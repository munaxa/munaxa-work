import type { ReactNode } from 'react';

import { count } from './exact';
import { Figure, Section, type SectionProps } from './sections';

/**
 * Four figures, and every one of them is a number the server counted.
 *
 * **Nothing here is computed.** Each figure is a `total` the API returned over its own predicate:
 * how many workflows this tenant has configured, how many approvals exist, how many steps are
 * waiting on the caller, and how many decisions the caller has made. None is a length of a page,
 * and none is derived from another.
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
  definitionsTotal,
  instancesTotal,
  pendingTotal,
  decidedTotal,
  unavailable,
}: SectionProps & {
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
      <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Figure t={t} label="definitionsTotal" value={count(definitionsTotal)} />
        <Figure t={t} label="instancesTotal" value={count(instancesTotal)} />
        <Figure t={t} label="pendingTotal" value={count(pendingTotal)} />
        <Figure t={t} label="decidedTotal" value={count(decidedTotal)} />
      </dl>
    )}
    <p className="text-xs opacity-60">{t('workflow.notice.queueIsAmbient')}</p>
  </Section>
);
