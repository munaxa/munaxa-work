import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AssignCompensationPlanCommand,
  DefineCompensationPlanCommand,
  PermitComponentCommand,
  PublishCompensationPlanCommand,
} from '../application/plan.use-case.js';
import type { ListPlans } from '../application/definition-queries.js';

import {
  AssignPlanBody,
  DefinePlanBody,
  PermitComponentBody,
  VersionedBody,
} from './compensation.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Compensation plans: the configuration an employment is assigned to.
 *
 * **The list starts empty and stays empty until somebody configures it.** There is no seed, no
 * suggestion and no default to delete.
 *
 * Publication is a `POST` to a sub-resource rather than a `PATCH` of a status field, because
 * publishing is an act with a consequence — every compensation record created under the version
 * will name it by identity for as long as the record exists — and it is behind its own permission.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'compensation/plans', version: '1' })
export class CompensationPlanController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The configured plans. Empty until a tenant configures one' })
  @ApiOkResponse({ description: 'Every plan version this tenant has defined.' })
  public async list(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListPlans>({ queryName: 'compensation.plans' }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Draft a compensation plan version' })
  public async define(@Body() body: DefinePlanBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineCompensationPlanCommand>({
        commandName: 'compensation.define-plan',
        ...body,
      }),
    );
  }

  @Post(':compensationPlanId/publication')
  @ApiOperation({ summary: 'Freeze a plan version, so it may be assigned' })
  public async publish(
    @Param('compensationPlanId') compensationPlanId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishCompensationPlanCommand>({
        commandName: 'compensation.publish-plan',
        compensationPlanId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':compensationPlanId/components')
  @ApiOperation({ summary: 'Permit a component under a draft plan, and on what terms' })
  public async permit(
    @Param('compensationPlanId') compensationPlanId: string,
    @Body() body: PermitComponentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PermitComponentCommand>({
        commandName: 'compensation.permit-component',
        compensationPlanId,
        ...body,
      }),
    );
  }

  @Post(':compensationPlanId/assignments')
  @ApiOperation({ summary: 'Bind a published plan version to a scope, effective-dated' })
  public async assign(
    @Param('compensationPlanId') compensationPlanId: string,
    @Body() body: AssignPlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignCompensationPlanCommand>({
        commandName: 'compensation.assign-plan',
        compensationPlanId,
        ...body,
      }),
    );
  }
}
