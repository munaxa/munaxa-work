import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ReadDevelopmentPlan } from '../application/career-record-queries.js';
import type {
  AcknowledgeDevelopmentPlanCommand,
  AddDevelopmentItemCommand,
  CreateDevelopmentPlanCommand,
  MoveDevelopmentPlanCommand,
} from '../application/development.use-case.js';
import type { Acknowledger } from '../domain/development.js';
import type {
  DevelopmentCategory,
  DevelopmentItemKind,
  DevelopmentPlanStatus,
} from '../domain/career-vocabulary.js';

import { CareerDispatcher } from './career-dispatcher.js';
import {
  AcknowledgeDevelopmentPlanBody,
  AddDevelopmentItemBody,
  CreateDevelopmentPlanBody,
  MoveDevelopmentPlanBody,
} from './career-people.dto.js';
import { optional, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Development plans: what somebody agreed to do, and whether the two parties acknowledged it.
 *
 * **A course item names a Learning assignment and carries no status of its own** (ADR-0073). The
 * employment the assignment is checked against comes from *the plan*, never from the request — so a
 * caller cannot attach a colleague's real assignment by naming it, and does not get to say whose it
 * is. Career stores the reference and nothing else: whether the course was completed is Learning's
 * answer, asked when somebody asks.
 *
 * **`party` records which side acknowledged; it is not a claim about who is calling** (D-9). This
 * repository cannot resolve a principal to an employment, so an API that inferred "you are the
 * employee" would be inventing the resolution rather than performing it. Both acknowledgements are
 * recorded by whoever holds `career.development.manage`, and the actor is taken from the request
 * context.
 *
 * **Nothing here validates a 70-20-10 balance.** A category is recorded and counted; the verdict is
 * the literal `NOT VERIFIED`, because the proportion was never approved as a rule and a computed
 * verdict would invent one (D-12).
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/development-plans', version: '1' })
export class CareerDevelopmentController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Post()
  @ApiOperation({ summary: 'Open a development plan for somebody' })
  public async create(@Body() body: CreateDevelopmentPlanBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateDevelopmentPlanCommand>({
        commandName: 'career.create-development-plan',
        employmentId: body.employmentId,
        startedOn: body.startedOn,
        ...present({
          careerPlanId: body.careerPlanId,
          cycleLabel: body.cycleLabel,
          targetDate: body.targetDate,
        }),
      }),
    );
  }

  @Get(':developmentPlanId')
  @ApiOperation({ summary: 'One plan, its items and the mix. The mix verdict is NOT VERIFIED' })
  public async read(
    @Param('developmentPlanId', ParseUUIDPipe) developmentPlanId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDevelopmentPlan>({
        queryName: 'career.read-development-plan',
        developmentPlanId,
        ...optional(query, ['asOf']),
      }),
    );
  }

  @Post(':developmentPlanId/status')
  @ApiOperation({ summary: 'Move a plan. A plan with no items does not become active' })
  public async move(
    @Param('developmentPlanId', ParseUUIDPipe) developmentPlanId: string,
    @Body() body: MoveDevelopmentPlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveDevelopmentPlanCommand>({
        commandName: 'career.move-development-plan',
        developmentPlanId,
        to: body.to as DevelopmentPlanStatus,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':developmentPlanId/acknowledgement')
  @ApiOperation({ summary: 'Record that a party acknowledged. Which party, not who is calling' })
  public async acknowledge(
    @Param('developmentPlanId', ParseUUIDPipe) developmentPlanId: string,
    @Body() body: AcknowledgeDevelopmentPlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AcknowledgeDevelopmentPlanCommand>({
        commandName: 'career.acknowledge-development-plan',
        developmentPlanId,
        party: body.party as Acknowledger,
        on: body.on,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':developmentPlanId/items')
  @ApiOperation({ summary: 'Add an item. A course item must name this person’s assignment' })
  public async addItem(
    @Param('developmentPlanId', ParseUUIDPipe) developmentPlanId: string,
    @Body() body: AddDevelopmentItemBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddDevelopmentItemCommand>({
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: body.category as DevelopmentCategory,
        kind: body.kind as DevelopmentItemKind,
        title: body.title,
        ...present({
          learningAssignmentId: body.learningAssignmentId,
          targetDate: body.targetDate,
        }),
      }),
    );
  }
}
