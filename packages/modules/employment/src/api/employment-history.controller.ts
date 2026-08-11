import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadEmploymentHistory } from '../application/employment-queries.js';

import { EmploymentDispatcher } from './employment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * How an employment came to be the way it is.
 *
 * All four timelines in one response — status, placement, reporting and contract — because they are
 * read together, and answering in four round trips is four chances for a screen to render a manager
 * from one date beside a department from another.
 *
 * Guarded by its own permission. A history carries the reason somebody was suspended and the actor
 * who recorded it, which is more than the ordinary read of an employment discloses.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks employment.history.read.' })
@ApiNotFoundResponse({ description: 'No such employment in this tenant.' })
@Controller({ path: 'employments', version: '1' })
export class EmploymentHistoryController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get(':employmentId/history')
  @ApiOperation({ summary: 'Status, placement, reporting and contract history in one response' })
  @ApiOkResponse({ description: 'Every period of every timeline, oldest first.' })
  public async read(@Param('employmentId') employmentId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentHistory>({
        queryName: 'employment.read-history',
        employmentId,
      }),
    );
  }
}
