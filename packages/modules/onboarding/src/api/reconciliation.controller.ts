import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AwaitingOnboarding, ReconcileOnboardingCommand } from '../application/reconcile.use-case.js';
import type { ExportOnboarding } from '../application/transfer.use-case.js';

import { ReconcileBody } from './onboarding.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Reconciliation, and the export.
 *
 * **Reconciliation is this module's reliability guarantee, and it is a route rather than a
 * background job.** Event delivery in this product is post-commit, in-process and at-most-once, with
 * no outbox: a hire event can be lost, and if starting an onboarding depended on one, a joiner would
 * silently have no induction. So the authoritative mechanism is the idempotent start command, and
 * this is how the gap is closed — `GET /reconciliation` names the employments that have no
 * onboarding, and `POST /reconciliation` starts one for each by sending the *same* command an
 * administrator would.
 *
 * It is **safe to rerun**: an employment that already has an onboarding of any state is skipped, and
 * the partial unique index refuses a second live instance even if two runs overlap. Running it twice
 * creates nothing twice.
 *
 * It is **not a scheduler**. Phase 7 introduces no job infrastructure; an operator or a deployment's
 * own scheduler calls this endpoint, and the outcome — scanned, started, already started, and every
 * failure with its reason — comes back in the response rather than into a log nobody reads.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiOkResponse({ description: 'The outcome of the run.' })
@Controller({ path: 'onboarding/reconciliation', version: '1' })
export class ReconciliationController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Employments that are eligible for onboarding and have none' })
  public async awaiting(@Query('limit') limit?: string): Promise<unknown> {
    const bounded = Number(limit);

    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, AwaitingOnboarding>({
        queryName: 'onboarding.awaiting-onboarding',
        ...(Number.isInteger(bounded) && bounded > 0 ? { limit: bounded } : {}),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Start an onboarding for each. Safe to rerun; never duplicates' })
  public async reconcile(@Body() body: ReconcileBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReconcileOnboardingCommand>({
        commandName: 'onboarding.reconcile',
        ...body,
      }),
    );
  }
}

/**
 * The onboarding register, in one response.
 *
 * Its own permission — `onboarding.export`, held by fewer people than read — because an export is
 * the highest-volume disclosure this module can make. It carries **no person's name and no document
 * reference**: joining names into it would put the register's personal data into one file governed
 * by this module's permission rather than People's.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'Requires onboarding.export.' })
@Controller({ path: 'onboarding/export', version: '1' })
export class OnboardingExportController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Every onboarding and task. No names, no document references' })
  @ApiOkResponse({ description: 'The register.' })
  public async exportAll(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ExportOnboarding>({ queryName: 'onboarding.export' }),
    );
  }
}
