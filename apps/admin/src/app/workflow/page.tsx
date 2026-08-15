import type { ReactNode } from 'react';

import { loadWorkflow, type WorkflowForDisplay } from '../../workflow/api';
import { directionOf, isLanguage, translator, type Language } from '../../workflow/locale';
import { OverviewSection } from '../../workflow/overview';
import { DefinitionsSection, StepsSection, VersionsSection } from '../../workflow/definitions';
import { InstanceStepsSection, InstancesSection } from '../../workflow/instances';
import { ApprovalStatusSection, DecidedSection, PendingSection } from '../../workflow/approvals';
import { HistorySection } from '../../workflow/history';
import { StatusSection } from '../../workflow/status';
import type { SectionProps } from '../../workflow/sections';

/**
 * The approvals screen: the processes a tenant configured, the approvals running against them, what
 * is waiting on the person reading, and how one approval got where it is.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no status derived a second time, no step scanned for to find the
 * current one, no queue assembled from anything but the queue endpoint. Those live in the domain and
 * the application service, and a screen that reimplemented them would be a second, weaker answer to
 * a question the API already decided. **It reaches no repository, no store, no domain entity and no
 * database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **Nothing on this page mutates anything.** There is no form, no button that posts and no state
 * this screen owns, which is the shape every Admin screen in this product has. The API has nine
 * commands and this screen sends none of them: raising an approval, deciding one, cancelling one,
 * publishing a version and retiring a workflow are named in the status section as API capabilities,
 * because a control that did nothing would be worse than a sentence that is honest about being one.
 *
 * **"Waiting for you" is the only thing on this page that is about a person, and the person is never
 * named by the client.** The API resolves the caller from the authenticated request; this screen
 * sends no membership, no workforce user, no platform user, no approver and no `me`. There is no
 * "my team" here either, and there could not be: Workflow resolves no reporting line and holds no
 * idea of a manager.
 *
 * **There is no Recruitment on this page.** An approval about a `recruitment.requisition` shows the
 * subject type Workflow stored and nothing more; this screen holds no Recruitment contract and makes
 * no request to one. The seam that carries a decision into Recruitment lives in the API, inside the
 * approver's own request, and it has no route anywhere.
 */
export default async function WorkflowPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const parameters = (await searchParams) ?? {};
  const requested = parameters['lang'];
  const language: Language = isLanguage(typeof requested === 'string' ? requested : undefined)
    ? (requested as Language)
    : 'en';
  const t = translator(language);
  const workflow = await loadWorkflow();
  const props = { t, language };

  return (
    <main dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('workflow.label.workflow')}</h1>

      <OverviewSection
        {...props}
        definitionsTotal={workflow.definitionsTotal}
        instancesTotal={workflow.instancesTotal}
        pendingTotal={workflow.pendingTotal}
        decidedTotal={workflow.decidedTotal}
        unavailable={workflow.unavailable}
      />

      <Configuration {...props} workflow={workflow} />
      <Running {...props} workflow={workflow} />
      <Queues {...props} workflow={workflow} />

      <StatusSection {...props} />
    </main>
  );
}

interface Workspace extends SectionProps {
  readonly workflow: WorkflowForDisplay;
}

/** What a tenant says an approval looks like: the workflows, their versions, the published chain. */
const Configuration = ({ workflow, ...props }: Workspace): ReactNode => (
  <>
    <DefinitionsSection
      {...props}
      definitions={workflow.definitions}
      total={workflow.definitionsTotal}
    />
    <VersionsSection {...props} detail={workflow.definition} />
    <StepsSection {...props} detail={workflow.definition} />
  </>
);

/** What is actually running against them, and one approval in full. */
const Running = ({ workflow, ...props }: Workspace): ReactNode => (
  <>
    <InstancesSection {...props} instances={workflow.instances} total={workflow.instancesTotal} />
    <InstanceStepsSection {...props} detail={workflow.instance} />
    <ApprovalStatusSection {...props} approval={workflow.approval} />
    <HistorySection {...props} history={workflow.history} total={workflow.historyTotal} />
  </>
);

/** The reader's own two lists, resolved from their request and from nothing they supplied. */
const Queues = ({ workflow, ...props }: Workspace): ReactNode => (
  <>
    <PendingSection {...props} pending={workflow.pending} total={workflow.pendingTotal} />
    <DecidedSection {...props} decided={workflow.decided} total={workflow.decidedTotal} />
  </>
);
