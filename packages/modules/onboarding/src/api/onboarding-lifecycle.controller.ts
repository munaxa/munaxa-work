import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  BeginOnboardingCommand,
  BeginPreboardingCommand,
  CancelOnboardingCommand,
  CompleteOnboardingCommand,
} from '../application/lifecycle.use-case.js';

import { CancelOnboardingBody } from './onboarding.dto.js';
import { VersionedBody } from './plan.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Moving an onboarding through its life, and ending it.
 *
 * Apart from the controller that starts and reads one because a controller's budget is 150 lines,
 * and because these four routes share a property the others do not: **each of them is a statement
 * about the onboarding and about nothing else.**
 *
 * Preboarding does not make anybody an employee. Commencement does not set an employment's start
 * date. Completion is not a hire, and cancellation is not a termination — a withdrawn joiner and a
 * no-show are employment facts Employment records, and the exit process is Offboarding's
 * (ADR-0047). Every one of these writes a state on one row in this module's own table.
 *
 * Each is a `POST` to a named sub-resource rather than a `PATCH` of a status field, so the audit
 * trail reads as decisions somebody made rather than as columns that changed.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such onboarding in this tenant.' })
@Controller({ path: 'onboarding/onboardings', version: '1' })
export class OnboardingLifecycleController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Post(':onboardingId/preboarding')
  @ApiOperation({ summary: 'Work begins before the first day. A state of the onboarding only' })
  public async beginPreboarding(
    @Param('onboardingId') onboardingId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, BeginPreboardingCommand>({
        commandName: 'onboarding.begin-preboarding',
        onboardingId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':onboardingId/commencement')
  @ApiOperation({ summary: 'The joiner has started. Employment status is unaffected' })
  public async beginOnboarding(
    @Param('onboardingId') onboardingId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, BeginOnboardingCommand>({
        commandName: 'onboarding.begin-onboarding',
        onboardingId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':onboardingId/completion')
  @ApiOperation({ summary: 'Complete. Refused while a required task is open' })
  @ApiUnprocessableEntityResponse({
    description: 'A required task is neither done nor waived.',
  })
  public async complete(
    @Param('onboardingId') onboardingId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CompleteOnboardingCommand>({
        commandName: 'onboarding.complete-onboarding',
        onboardingId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':onboardingId/cancellation')
  @ApiOperation({ summary: 'Cancel it and every open task. Ends no employment' })
  public async cancel(
    @Param('onboardingId') onboardingId: string,
    @Body() body: CancelOnboardingBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelOnboardingCommand>({
        commandName: 'onboarding.cancel-onboarding',
        onboardingId,
        ...body,
      }),
    );
  }
}
