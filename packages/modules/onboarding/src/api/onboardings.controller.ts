import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { StartOnboardingCommand } from '../application/start.use-case.js';
import type { ReadOnboarding, SearchOnboardings } from '../application/onboarding-queries.js';

import { StartOnboardingBody } from './onboarding.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { flag, onboardingFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Onboardings: starting one, moving it, and ending it.
 *
 * **`POST /onboardings` is idempotent, and that is the module's central reliability property.**
 * Sending it twice for the same employment returns the same onboarding with `alreadyExisted: true`
 * and a `200`, not a `409` and not a second instance. The boundary is a partial unique index on
 * (tenant, employment) over the live states, so two *concurrent* requests converge on one instance
 * as well (ADR-0050). A client may retry freely; that is what makes this — rather than a hire event
 * — the authoritative way an onboarding begins.
 *
 * **Nothing here writes an employment fact.** Completing an onboarding does not make anybody an
 * employee, and cancelling one ends no employment: a withdrawn hire and a no-show are Employment's
 * to record, and the exit process is Offboarding's (ADR-0047).
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such onboarding or employment in this tenant.' })
@Controller({ path: 'onboarding/onboardings', version: '1' })
export class OnboardingsController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search onboardings. `overdue=true` is computed, never a stored flag' })
  @ApiOkResponse({ description: 'A page of onboardings.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchOnboardings>({
        queryName: 'onboarding.search',
        ...onboardingFilters(query),
        ...flag(query, 'overdue'),
        ...paging(query),
      }),
    );
  }

  @Get(':onboardingId')
  @ApiOperation({ summary: 'One onboarding, its tasks and its progress' })
  @ApiOkResponse({ description: 'Progress is counted in the database, not by loading the list.' })
  public async read(@Param('onboardingId') onboardingId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadOnboarding>({
        queryName: 'onboarding.read',
        onboardingId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Start an onboarding for an existing employment. Safe to retry' })
  @ApiOkResponse({
    description:
      'The onboarding. `alreadyExisted` is true when an earlier request created it — both are successes.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The employment has ended, or the person was merged away.',
  })
  public async start(@Body() body: StartOnboardingBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, StartOnboardingCommand>({
        commandName: 'onboarding.start-onboarding',
        ...body,
      }),
    );
  }
}
