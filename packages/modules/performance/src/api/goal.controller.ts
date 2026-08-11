import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ApproveGoalCommand,
  CreateGoalCommand,
  MoveGoalCommand,
  UpdateGoalCommand,
} from '../application/goal.use-case.js';
import type { ReadGoal, SearchGoals } from '../application/performance-queries.js';
import type { GoalStatus } from '../domain/performance-vocabulary.js';

import { VersionedBody } from './performance.dto.js';
import { CreateGoalBody, MoveGoalBody, UpdateGoalBody } from './goal.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { civil, civilIf, optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Goals: setting them, approving them, recording progress against them, closing them.
 *
 * **`managerEmploymentId` on the search is a filter, not a credential.** A caller holding
 * `goal.read` may narrow to one manager's reports; a caller holding only `goal.read-team` reads
 * nothing, whatever they supply, because nothing in this product can yet prove they are that
 * manager. The application decides that — see `goalScopeFor` — and this controller passes the
 * parameter through without interpreting it.
 *
 * **Approval is a named human's act.** `system:auto-approval` is refused by the aggregate, by a
 * check constraint, and there is no route here that could supply an actor at all: it comes from the
 * authenticated context.
 *
 * Progress is **appended, never rewritten** — a trigger refuses an update to an entry — so the
 * history of a goal is what actually happened rather than what it currently looks like.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/goals', version: '1' })
export class PerformanceGoalController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search goals. Bounded, and scoped before the store' })
  @ApiOkResponse({
    description:
      'A read-team caller with no trusted manager context receives an empty page rather than a ' +
      'refusal: a count of what was withheld is itself a disclosure.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchGoals>({
        queryName: 'performance.goals',
        ...paged(query),
        ...optional(query, [
          'employmentId',
          'organizationUnitId',
          'cycleId',
          'status',
          'managerEmploymentId',
        ]),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Set a goal. Weights are basis points; dates are civil dates' })
  public async create(@Body() body: CreateGoalBody): Promise<unknown> {
    const { startDate, dueDate, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateGoalCommand>({
        commandName: 'performance.create-goal',
        ...rest,
        startDate: civil(startDate),
        dueDate: civil(dueDate),
      }),
    );
  }

  @Get(':goalId')
  @ApiOperation({ summary: 'One goal with its progress history' })
  public async read(@Param('goalId') goalId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadGoal>({ queryName: 'performance.read-goal', goalId }),
    );
  }

  @Patch(':goalId')
  @ApiOperation({ summary: 'Amend a goal that has not been closed' })
  public async update(
    @Param('goalId') goalId: string,
    @Body() body: UpdateGoalBody,
  ): Promise<unknown> {
    const { dueDate, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, UpdateGoalCommand>({
        commandName: 'performance.update-goal',
        goalId,
        ...rest,
        ...present({ dueDate: civilIf(dueDate) }),
      }),
    );
  }

  @Post(':goalId/approval')
  @ApiOperation({ summary: 'Approve a goal. A named human, never the auto-approver' })
  public async approve(
    @Param('goalId') goalId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ApproveGoalCommand>({
        commandName: 'performance.approve-goal',
        goalId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':goalId/status')
  @ApiOperation({ summary: 'Move a goal. Closing has its own route' })
  public async move(@Param('goalId') goalId: string, @Body() body: MoveGoalBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveGoalCommand>({
        commandName: 'performance.move-goal',
        goalId,
        expectedVersion: body.expectedVersion,
        status: body.status as GoalStatus,
      }),
    );
  }
}
