import { loadPortalProcessEnvironment } from '@work/config';
import type { OnboardingView, PlanView, TaskView } from '@work/onboarding/contracts';

/**
 * Reading the onboarding register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032). So
 * these calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page, because "not signed in yet" is the expected
 * condition today rather than a fault.
 */

export interface OnboardingForDisplay {
  readonly onboardings: readonly OnboardingView[];
  readonly plans: readonly PlanView[];
  readonly overdue: readonly TaskView[];
  /** Employments that have no onboarding — reconciliation's list, read rather than run. */
  readonly awaiting: readonly AwaitingEmployment[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

export interface AwaitingEmployment {
  readonly employmentId: string;
  readonly startDate: string;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/onboarding${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

/**
 * The four reads the screen makes, and nothing else.
 *
 * The awaiting list is read but **never acted on from here**: this screen is read-only, and running
 * reconciliation is a `POST` an operator or a scheduler makes. Showing the count is what turns a
 * silent gap — a joiner whose hire event was lost — into something a human can see.
 */
export const loadOnboarding = async (): Promise<OnboardingForDisplay> => {
  const onboardings = await read<Page<OnboardingView>>('/onboardings');

  if (onboardings === undefined) {
    return { onboardings: [], plans: [], overdue: [], awaiting: [], unavailable: true };
  }

  const plans = await read<Page<PlanView>>('/plans');
  const overdue = await read<Page<TaskView>>('/tasks?overdue=true');
  const awaiting = await read<{ employments: readonly AwaitingEmployment[] }>('/reconciliation');

  return {
    onboardings: onboardings.items,
    plans: plans?.items ?? [],
    overdue: overdue?.items ?? [],
    awaiting: awaiting?.employments ?? [],
    unavailable: false,
  };
};
