import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  CloseGoalCommand,
  RecordGoalProgressCommand,
} from '../application/goal-progress.use-case.js';

import { CloseGoalBody, RecordProgressBody } from './goal.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What happened to a goal: progress against it, and how it ended.
 *
 * Progress is **appended, never rewritten**. A trigger refuses an update to an entry, so the history
 * of a goal is what actually happened rather than what it currently looks like — which is the
 * difference between a record somebody can rely on in a disagreement and a number that changed.
 *
 * `observedValue` is an **exact decimal string** rather than a JSON number, because a measurement
 * can exceed 2^53 and a number above that is not the number that was sent. It is parsed with
 * `BigInt` and never with `Number`.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/goals', version: '1' })
export class PerformanceGoalProgressController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':goalId/progress')
  @ApiOperation({ summary: 'Append a progress entry. Entries are never rewritten' })
  @ApiOkResponse({ description: 'observedValue is an exact decimal string, never a JSON number.' })
  public async recordProgress(
    @Param('goalId') goalId: string,
    @Body() body: RecordProgressBody,
  ): Promise<unknown> {
    const { observedValue, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordGoalProgressCommand>({
        commandName: 'performance.record-goal-progress',
        goalId,
        ...rest,
        // `BigInt(string)` and never `Number(string)`. The pattern the DTO matched guarantees this
        // parses; what it does not guarantee is that the value fits in a double, which is the whole
        // reason it arrived as text.
        ...present({
          observedValue: observedValue === undefined ? undefined : BigInt(observedValue),
        }),
      }),
    );
  }

  @Post(':goalId/closure')
  @ApiOperation({ summary: 'Close a goal as achieved, missed or cancelled' })
  public async close(
    @Param('goalId') goalId: string,
    @Body() body: CloseGoalBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseGoalCommand>({
        commandName: 'performance.close-goal',
        goalId,
        ...body,
        outcome: body.outcome as CloseGoalCommand['outcome'],
      }),
    );
  }
}
