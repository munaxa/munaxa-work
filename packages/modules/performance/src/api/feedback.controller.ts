import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  GiveFeedbackCommand,
  WithdrawFeedbackCommand,
} from '../application/feedback.use-case.js';
import type { ReadReconciliation, SearchFeedback } from '../application/review-queries.js';

import { GiveFeedbackBody, WithdrawFeedbackBody } from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { optional, paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Continuous feedback: giving it, reading it, withdrawing it.
 *
 * **Withdrawal is not deletion and not editing.** A withdrawn piece of feedback keeps every word it
 * had; what changes is that it is marked withdrawn. A trigger refuses both a delete and a content
 * change, so a author who regretted their wording cannot quietly rewrite what somebody already
 * read — which is the whole reason the record is worth keeping.
 *
 * **`visibility` offers no `anonymous` value.** Every row carries `created_by`, the correlation
 * identifier records the request, and row-level security is tenant-scoped. Hiding an author in a
 * screen is a presentation choice; it is not anonymity, and this API does not claim one.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/feedback', version: '1' })
export class PerformanceFeedbackController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search feedback. Bounded, and scoped before the store' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchFeedback>({
        queryName: 'performance.feedback',
        ...paged(query),
        ...optional(query, ['subjectEmploymentId', 'relatedReviewId', 'managerEmploymentId']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Give feedback about somebody' })
  public async give(@Body() body: GiveFeedbackBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, GiveFeedbackCommand>({
        commandName: 'performance.give-feedback',
        ...body,
      }),
    );
  }

  @Post(':feedbackId/withdrawal')
  @ApiOperation({ summary: 'Withdraw feedback. Every word of it is kept' })
  @ApiOkResponse({ description: 'A trigger refuses a delete and refuses a content change.' })
  public async withdraw(
    @Param('feedbackId') feedbackId: string,
    @Body() body: WithdrawFeedbackBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WithdrawFeedbackCommand>({
        commandName: 'performance.withdraw-feedback',
        feedbackId,
        ...body,
      }),
    );
  }
}

/**
 * What reconciliation found. It reports; it repairs nothing.
 *
 * Behind its own permission because a list of what is wrong with a cycle — reviews with no
 * assessment, goals whose weights do not total, panels below their minimum — is itself worth
 * restricting.
 *
 * **Nothing here recovers a lost event, because nothing publishes one.** This module pulls every
 * cross-module fact at the moment it needs it, so there is no delivery to lose; reconciliation finds
 * inconsistencies inside the module's own data.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/reconciliation', version: '1' })
export class PerformanceReconciliationController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'What reconciliation found in a cycle. Bounded' })
  public async findings(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadReconciliation>({
        queryName: 'performance.reconciliation',
        cycleId: query['cycleId'] ?? '',
        ...paged(query),
      }),
    );
  }
}
