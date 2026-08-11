import { Module } from '@nestjs/common';
import {
  ApplicationsController,
  CandidateRecordsController,
  CandidatesController,
  HireController,
  InterviewsController,
  OffersController,
  RecruitmentDispatcher,
  RequisitionDecisionsController,
  RequisitionsController,
  VacanciesController,
} from '@work/recruitment';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Recruitment's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `recruitment.composition.ts` rather than here, because the
 * identity module's composition registers Recruitment on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts a
 * cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. `GET /recruitment/export` is one
  // segment after `/recruitment`, and several controllers share that prefix — Nest resolves a route
  // by the order its controllers were declared, so the specific paths are declared first.
  controllers: [
    HireController,
    RequisitionDecisionsController,
    RequisitionsController,
    VacanciesController,
    CandidateRecordsController,
    CandidatesController,
    InterviewsController,
    ApplicationsController,
    OffersController,
  ],
  providers: [
    {
      provide: RecruitmentDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): RecruitmentDispatcher =>
        new RecruitmentDispatcher(dispatcher),
    },
  ],
})
export class RecruitmentModule {}
