import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ReadCaseHistory } from '../application/relations-queries.js';

import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * A case's current state and every transition behind it.
 *
 * Its own controller because its path is the *violation's*, not an investigation's: a case is
 * identified by the matter it concerns, and the inquiries are things that happened to it.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/cases', version: '1' })
export class CaseHistoryController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get(':violationId/history')
  @ApiOperation({ summary: 'Where a case is, and every transition that got it there' })
  @ApiOkResponse({ description: 'The current state is derived from the history, not stored.' })
  public async history(@Param('violationId', ParseUUIDPipe) violationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCaseHistory>({
        queryName: 'relations.case-history',
        violationId,
      }),
    );
  }
}
