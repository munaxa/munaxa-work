import { Module } from '@nestjs/common';
import {
  IssuedLetterController,
  LetterIssuanceController,
  LetterRequestController,
  LetterTemplateController,
  LettersDispatcher,
} from '@work/letters';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Letters' transport, dispatching through the pipeline the identity module assembled.
 *
 * The module's *composition* lives in `letters.composition.ts` rather than here, for the same
 * reason every module before it separates the two: the identity module registers Letters on the
 * shared registry while this file imports the identity module to reach the dispatcher, and keeping
 * both in one file would make those two facts a cycle.
 */
@Module({
  imports: [IdentityModule],
  // Order matters. `LetterTemplateController` owns the literal `letters/templates` prefix and is
  // declared first; `LetterRequestController` declares `reconciliation` before its
  // `:letterRequestId` routes; `IssuedLetterController` declares `verification` before its
  // `:issuedLetterId` route. An API test asserts the resolution rather than trusting this comment.
  controllers: [
    LetterTemplateController,
    LetterRequestController,
    LetterIssuanceController,
    IssuedLetterController,
  ],
  providers: [
    {
      provide: LettersDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): LettersDispatcher => new LettersDispatcher(dispatcher),
    },
  ],
})
export class LettersModule {}
