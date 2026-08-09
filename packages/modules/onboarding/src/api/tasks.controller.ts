import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  CompleteTaskCommand,
  ReassignTaskCommand,
  RescheduleTaskCommand,
  WaiveTaskCommand,
} from '../application/task.use-case.js';
import type { ReadTaskHistory, SearchTasks } from '../application/task-queries.js';

import {
  CompleteTaskBody,
  ReassignTaskBody,
  RescheduleTaskBody,
  WaiveTaskBody,
} from './onboarding.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { flag, paging, taskFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Onboarding tasks: the queue somebody opens, and the four things they can do to a task.
 *
 * **Waiving is not completing**, and they are different permissions on different routes. "We did it"
 * and "it did not apply to this person" are different answers, and the second is the one an auditor
 * asks about; a required task waived by somebody unauthorized to waive it is how a completion record
 * stops meaning anything.
 *
 * **Every movement writes a history row in the same transaction**, readable at
 * `GET /tasks/:taskId/history`. That is where "who moved this deadline" is answered, and the actor on
 * every row came from the authenticated context rather than from a body.
 *
 * **Two published operations have no route here, deliberately.**
 * `onboarding.read-my-tasks` and `onboarding.complete-own-task` are the contracts Employee
 * Self-Service will consume (Phase 18). Both need the caller's *own* employment, and this product
 * has no edge that resolves an authenticated member to an employment today — the execution context
 * carries a tenant, an actor and a correlation, and nothing else. Mounting them now would mean
 * taking the employment from the request, which is precisely the shape that lets somebody close
 * another person's task. They are dispatchable and tested; they are not routed, and the completion
 * report says so rather than claiming self-service works.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such task in this tenant.' })
@Controller({ path: 'onboarding/tasks', version: '1' })
export class TasksController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search tasks. `overdue=true` compares due date to today' })
  @ApiOkResponse({ description: 'A page of tasks. Overdue is computed, never a stored flag.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchTasks>({
        queryName: 'onboarding.search-tasks',
        ...taskFilters(query),
        ...flag(query, 'overdue'),
        ...flag(query, 'requiredOnly'),
        ...paging(query),
      }),
    );
  }

  @Get(':taskId/history')
  @ApiOperation({ summary: 'Everything that happened to one task, oldest first' })
  @ApiOkResponse({ description: 'Append-only. No endpoint amends a history row.' })
  public async history(@Param('taskId') taskId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadTaskHistory>({
        queryName: 'onboarding.read-task-history',
        taskId,
      }),
    );
  }

  @Post(':taskId/completion')
  @ApiOperation({ summary: 'Complete a task. A document task records a reference, never bytes' })
  @ApiUnprocessableEntityResponse({
    description: 'The task is blocked, already concluded, or a document task named no reference.',
  })
  public async complete(
    @Param('taskId') taskId: string,
    @Body() body: CompleteTaskBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CompleteTaskCommand>({
        commandName: 'onboarding.complete-task',
        taskId,
        ...body,
      }),
    );
  }

  @Post(':taskId/waiver')
  @ApiOperation({ summary: 'Waive a task, naming why. Requires onboarding.task.waive' })
  public async waive(
    @Param('taskId') taskId: string,
    @Body() body: WaiveTaskBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WaiveTaskCommand>({
        commandName: 'onboarding.waive-task',
        taskId,
        ...body,
      }),
    );
  }

  @Post(':taskId/assignment')
  @ApiOperation({ summary: 'Reassign a task to another owner' })
  public async reassign(
    @Param('taskId') taskId: string,
    @Body() body: ReassignTaskBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReassignTaskCommand>({
        commandName: 'onboarding.reassign-task',
        taskId,
        ...body,
      }),
    );
  }

  @Post(':taskId/schedule')
  @ApiOperation({ summary: 'Move a deadline. Audited — a date that quietly moved is a date missed' })
  public async reschedule(
    @Param('taskId') taskId: string,
    @Body() body: RescheduleTaskBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RescheduleTaskCommand>({
        commandName: 'onboarding.reschedule-task',
        taskId,
        ...body,
      }),
    );
  }
}
