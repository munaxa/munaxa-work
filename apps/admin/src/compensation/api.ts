import { apiRead } from '../shell/api-request';
import type {
  CompensationAdjustmentView,
  CompensationChangeView,
  CompensationComponentView,
  CompensationDashboardView,
  CompensationPlanView,
  ImportBatchView,
  OneTimeCompensationView,
  PayGradeView,
  PayScaleView,
  RecurringCompensationView,
  SalaryStepView,
  SalaryStructureView,
} from '@work/compensation/contracts';

/**
 * Reading the compensation register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet" is
 * the expected condition today rather than a fault.
 *
 * **The adjustment read is expected to fail for most callers, and that is the design.** Adjustments
 * sit behind `compensation.adjust` rather than `compensation.read`, so a caller who can see the
 * figures and not the reasons gets an empty adjustments table — which is exactly what that
 * permission separation means.
 */

export interface CompensationForDisplay {
  readonly dashboard: CompensationDashboardView | undefined;
  readonly plans: readonly CompensationPlanView[];
  readonly structures: readonly SalaryStructureView[];
  readonly grades: readonly PayGradeView[];
  readonly scales: readonly PayScaleView[];
  readonly steps: readonly SalaryStepView[];
  readonly components: readonly CompensationComponentView[];
  readonly recurring: readonly RecurringCompensationView[];
  readonly oneTime: readonly OneTimeCompensationView[];
  readonly adjustments: readonly CompensationAdjustmentView[];
  readonly history: readonly CompensationChangeView[];
  readonly future: readonly RecurringCompensationView[];
  readonly imports: readonly ImportBatchView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

const read = async <TValue>(path: string): Promise<TValue | undefined> =>
  apiRead<TValue>(`/compensation${path}`);

interface Page<TItem> {
  readonly items: readonly TItem[];
}

const EMPTY: CompensationForDisplay = {
  dashboard: undefined,
  plans: [],
  structures: [],
  grades: [],
  scales: [],
  steps: [],
  components: [],
  recurring: [],
  oneTime: [],
  adjustments: [],
  history: [],
  future: [],
  imports: [],
  unavailable: true,
};

/**
 * The reads the screen makes.
 *
 * The dashboard is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadCompensation = async (): Promise<CompensationForDisplay> => {
  const dashboard = await read<CompensationDashboardView>('/dashboard');

  if (dashboard === undefined) return EMPTY;

  const registers = await lists();

  return {
    dashboard,
    unavailable: false,
    ...registers,
    // The history and future-change reads are **per employment**, so the screen shows them for the
    // first row of the register rather than pretending there is a tenant-wide answer. There is no
    // tenant-wide history endpoint, and inventing one here would be a screen answering a question
    // the module deliberately scopes.
    ...(await forEmployment(registers.recurring[0]?.employmentId)),
  };
};

/** One employment's history and scheduled changes, or nothing when the register is empty. */
const forEmployment = async (
  employmentId: string | undefined,
): Promise<Pick<CompensationForDisplay, 'history' | 'future'>> => {
  if (employmentId === undefined) return { history: [], future: [] };

  return {
    history: itemsOf(
      await read<Page<CompensationChangeView>>(`/employments/${employmentId}/history`),
    ),
    future: itemsOf(
      await read<Page<RecurringCompensationView>>(`/employments/${employmentId}/future`),
    ),
  };
};

const lists = async (): Promise<
  Omit<CompensationForDisplay, 'dashboard' | 'unavailable' | 'history' | 'future'>
> => ({
  plans: itemsOf(await read<Page<CompensationPlanView>>('/plans')),
  structures: itemsOf(await read<Page<SalaryStructureView>>('/structures')),
  grades: itemsOf(await read<Page<PayGradeView>>('/grades')),
  scales: itemsOf(await read<Page<PayScaleView>>('/scales')),
  steps: itemsOf(await read<Page<SalaryStepView>>('/steps')),
  components: itemsOf(await read<Page<CompensationComponentView>>('/components')),
  recurring: itemsOf(await read<Page<RecurringCompensationView>>('/recurring')),
  oneTime: itemsOf(await read<Page<OneTimeCompensationView>>('/one-time')),
  adjustments: itemsOf(await read<Page<CompensationAdjustmentView>>('/adjustments')),
  imports: itemsOf(await read<Page<ImportBatchView>>('/imports')),
});

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];
