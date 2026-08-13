import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadLearningHistory } from '../application/learning-history.js';

import { LearningDispatcher } from './learning-dispatcher.js';
import { noticeDays, optional, paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * One person's learning record: what they were asked to do, what they sat, and what they hold.
 *
 * **Assembled on read from the three authoritative tables.** Nothing maintains a summary row, so
 * there is no projection to fall behind and none to rebuild — the counts are what the tables say at
 * the moment of the read.
 *
 * **A record the caller may not see is 404, not 403.** Confirming that a training record exists for
 * a named employment says something about the person on it: a remedial safety course, a revoked
 * licence. The application decides that and returns `not_found`; nothing on this path softens it
 * into a refusal that would confirm what it declined to show.
 *
 * **The employment identifier in the path is what is being asked about, not who is asking.** The
 * acting identity comes from the authenticated context, and the scope is resolved before the
 * identifier is used — a caller who cannot see this person's record sees nothing whatever they put
 * in the URL.
 *
 * **Bounded.** A long career still returns a bounded page of each kind, and the bound is applied by
 * the store rather than by a slice taken after loading everything.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/history', version: '1' })
export class LearningHistoryController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get(':employmentId')
  @ApiOperation({ summary: 'One person’s learning history, with both derived answers' })
  @ApiOkResponse({ description: '`asOf` is echoed, so a screen can say what day it answered for.' })
  @ApiNotFoundResponse({
    description: 'No such record, or none this caller may see. Deliberately the same answer.',
  })
  public async read(
    @Param('employmentId') employmentId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadLearningHistory>({
        queryName: 'learning.read-history',
        employmentId,
        noticeDays: noticeDays(query),
        // The history's own default page is larger than a search's, so a size is passed only when
        // the caller asked for one rather than silently narrowing somebody's record to fifty rows.
        ...(query['size'] === undefined ? {} : { size: paged(query).size }),
        ...optional(query, ['asOf']),
      }),
    );
  }
}
