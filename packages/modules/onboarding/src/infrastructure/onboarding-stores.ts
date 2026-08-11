import type { OnboardingStores } from '../application/onboarding-ports.js';

import {
  PlanRepository,
  PlanVersionRepository,
  TaskTemplateRepository,
} from './plan.repository.js';
import { OnboardingRepository } from './onboarding.repository.js';
import { TaskEventRepository } from './task-event.repository.js';
import { TaskRepository } from './task.repository.js';

/**
 * The PostgreSQL implementation of every store the application declares.
 *
 * Assembled here so the composition root wires one thing rather than six, and so that swapping an
 * implementation is one edit rather than a search. The repositories hold no state and no connection
 * — every method takes the `Transaction` — so one instance each is correct and a per-request factory
 * would only be ceremony.
 */
export const postgresOnboardingStores = (): OnboardingStores => ({
  plans: new PlanRepository(),
  planVersions: new PlanVersionRepository(),
  templates: new TaskTemplateRepository(),
  onboardings: new OnboardingRepository(),
  tasks: new TaskRepository(),
  taskEvents: new TaskEventRepository(),
});
