import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  CancelCycleCommand,
  CloseCycleCommand,
  MoveCycleCommand,
  OpenCycleCommand,
} from '../application/cycle.use-case.js';
import type { ListCycles } from '../application/performance-queries.js';
import type { CycleStatus } from '../domain/performance-vocabulary.js';

import { CancelCycleBody, MoveCycleBody, VersionedBody } from './performance.dto.js';
import { CreateCycleBody } from './goal.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { civil, civilIf, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Review cycles, and the enrolment that fills one.
 *
 * **Closing and cancelling have their own routes**, separate from the generic move. Each carries
 * something the move has nowhere to put — a closing actor, a cancellation reason — and a cycle that
 * reached `closed` through the move would be a closed cycle with nobody's name against it. Nothing
 * closes on a schedule: no scheduler is verified anywhere in this repository, so a cycle closes
 * because somebody closed it.
 *
 * **Enrolment resolves employments through Employment's published contract** and never from a list
 * a client asserted is a team. Naming employments explicitly is permitted — that is a list of
 * subjects, not a claim about who manages them — and each is confirmed active before a review
 * exists for it. Enrolment is re-runnable: an employment already enrolled is skipped rather than
 * duplicated, which is what makes recovering from a half-finished enrolment a matter of running it
 * again.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/cycles', version: '1' })
export class PerformanceCycleController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The review cycles. Bounded' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListCycles>({
        queryName: 'performance.cycles',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a cycle on a template. Dates are civil dates' })
  public async create(@Body() body: CreateCycleBody): Promise<unknown> {
    const {
      periodStart,
      periodEnd,
      selfAssessmentDue,
      managerAssessmentDue,
      peerAssessmentDue,
      calibrationDue,
      ...rest
    } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, OpenCycleCommand>({
        commandName: 'performance.create-cycle',
        ...rest,
        periodStart: civil(periodStart),
        periodEnd: civil(periodEnd),
        // Every optional date is destructured out of `rest` before the spread. Leaving one in would
        // let the string reach the command beside the `Date` that replaced it, and the field would
        // type as `string | Date` — the Phase 8 defect, caught by the compiler this time.
        ...present({
          selfAssessmentDue: civilIf(selfAssessmentDue),
          managerAssessmentDue: civilIf(managerAssessmentDue),
          peerAssessmentDue: civilIf(peerAssessmentDue),
          calibrationDue: civilIf(calibrationDue),
        }),
      }),
    );
  }

  @Post(':cycleId/status')
  @ApiOperation({ summary: 'Move a cycle. Closing and cancelling have their own routes' })
  public async move(
    @Param('cycleId') cycleId: string,
    @Body() body: MoveCycleBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveCycleCommand>({
        commandName: 'performance.move-cycle',
        cycleId,
        expectedVersion: body.expectedVersion,
        status: body.status as CycleStatus,
      }),
    );
  }

  @Post(':cycleId/closure')
  @ApiOperation({ summary: 'Close a cycle. A named human closes it; nothing closes on a timer' })
  @ApiOkResponse({ description: 'A closed cycle does not reopen. Its reviews are immutable.' })
  public async close(
    @Param('cycleId') cycleId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseCycleCommand>({
        commandName: 'performance.close-cycle',
        cycleId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':cycleId/cancellation')
  @ApiOperation({ summary: 'Cancel a cycle. The reason is mandatory' })
  public async cancel(
    @Param('cycleId') cycleId: string,
    @Body() body: CancelCycleBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelCycleCommand>({
        commandName: 'performance.cancel-cycle',
        cycleId,
        ...body,
      }),
    );
  }
}
