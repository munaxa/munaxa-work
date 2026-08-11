import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  DraftPlanVersionCommand,
  PublishPlanVersionCommand,
} from '../application/plan-version.use-case.js';
import type {
  DefineTaskTemplateCommand,
  RemoveTaskTemplateCommand,
} from '../application/task-template.use-case.js';

import { DefineTaskTemplateBody, DraftPlanVersionBody, VersionedBody } from './plan.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Plan versions and the templates they hold.
 *
 * **A published version is immutable, and every route here respects that.** Defining and removing a
 * template refuse unless the version is a draft; there is no edit endpoint for a published one and
 * there will not be. An administrator improving the checklist drafts the *next* version, and the
 * published one stays exactly as it was, because instances were generated from it and an auditor
 * will read it (ADR-0048).
 *
 * **Publishing has its own permission.** It is the moment a checklist becomes what every onboarding
 * started afterwards is measured against — a control rather than a document — and the person
 * drafting next quarter's version does not automatically hold it.
 *
 * A template is removed by `DELETE`, and the row is soft-deleted: "who took the safety briefing off
 * the field-engineer plan" is a question a hard delete makes unanswerable.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such plan, version or template in this tenant.' })
@Controller({ path: 'onboarding', version: '1' })
export class PlanVersionsController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Post('plans/:planId/versions')
  @ApiOperation({ summary: 'Draft the next version, optionally copying the published one' })
  @ApiCreatedResponse({ description: 'The version identifier and its number.' })
  @ApiConflictResponse({ description: 'A draft already exists, or the plan is retired.' })
  public async draft(
    @Param('planId') planId: string,
    @Body() body: DraftPlanVersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DraftPlanVersionCommand>({
        commandName: 'onboarding.draft-plan-version',
        planId,
        ...body,
      }),
    );
  }

  @Post('plan-versions/:planVersionId/templates')
  @ApiOperation({ summary: 'Add a task template to a draft version' })
  @ApiCreatedResponse({ description: 'The template identifier.' })
  @ApiConflictResponse({
    description: 'The version is published. A published checklist never changes.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The owner and its kind disagree, or a document task names no document type.',
  })
  public async defineTemplate(
    @Param('planVersionId') planVersionId: string,
    @Body() body: DefineTaskTemplateBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineTaskTemplateCommand>({
        commandName: 'onboarding.define-task-template',
        planVersionId,
        ...body,
      }),
    );
  }

  @Delete('plan-versions/:planVersionId/templates/:code')
  @ApiOperation({ summary: 'Remove a template from a draft version. Soft — the row is kept' })
  @ApiConflictResponse({ description: 'The version is published.' })
  public async removeTemplate(
    @Param('planVersionId') planVersionId: string,
    @Param('code') code: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RemoveTaskTemplateCommand>({
        commandName: 'onboarding.remove-task-template',
        planVersionId,
        code,
      }),
    );
  }

  @Post('plan-versions/:planVersionId/publication')
  @ApiOperation({ summary: 'Publish. Requires onboarding.plan.publish' })
  @ApiUnprocessableEntityResponse({
    description:
      'The version holds no templates. An empty checklist produces onboardings that complete the moment they begin.',
  })
  public async publish(
    @Param('planVersionId') planVersionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishPlanVersionCommand>({
        commandName: 'onboarding.publish-plan-version',
        planVersionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
