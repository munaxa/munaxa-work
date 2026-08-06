import { Module } from '@nestjs/common';
import {
  ContactsController,
  DuplicatesController,
  IdentifiersController,
  PeopleController,
  PeopleDispatcher,
  PersonLifecycleController,
  PersonalDetailsController,
  ProfileController,
  TransferController,
} from '@work/people';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * People's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a third of the permissions and the navigation a third of the entries.
 * What is not shared is the transport — a module owns its own controllers.
 *
 * The module's *composition* lives in `people.composition.ts` rather than here, because the
 * identity module's composition registers People on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape Organization has, and the same fix.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. `GET /people/duplicates` and
  // `GET /people/export` are both one segment after `/people`, which is also the shape of
  // `GET /people/:personId` — and Nest resolves a route by the order its controllers were
  // declared. Declared the other way round, the review queue would answer "no such person".
  //
  // `people.controller.spec.ts` asserts that both resolve to the collection, so a reordering is a
  // failing test rather than a 404 somebody finds in production.
  controllers: [
    DuplicatesController,
    TransferController,
    PersonLifecycleController,
    IdentifiersController,
    ContactsController,
    PersonalDetailsController,
    ProfileController,
    PeopleController,
  ],
  providers: [
    {
      provide: PeopleDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): PeopleDispatcher => new PeopleDispatcher(dispatcher),
    },
  ],
})
export class PeopleModule {}
