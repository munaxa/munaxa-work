import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AssignLearningCommand,
  CancelAssignmentCommand,
  WaiveAssignmentCommand,
} from '../application/assignment.use-case.js';
import type { SearchAssignments } from '../application/learning-record-queries.js';

import { ReasonedBody, VersionedBody } from './learning.dto.js';
import { AssignBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What a named person was asked to do, and the two ways an obligation ends without being done.
 *
 * **`employmentId` on the search is a filter, never a credential.** The application scopes the read
 * before it applies any filter: a caller holding `assignment.read-all` sees the organization, and a
 * caller holding only `assignment.read-team` sees **nothing at all**, because nothing in this
 * repository can prove they are anybody's manager (ADR-0032). Supplying an employment identifier
 * never widens what a caller may see — that would be an IDOR by another name, and the record it
 * would disclose is somebody's remedial safety training.
 *
 * **Overdue-ness is a filter, not a stored flag.** `dueOnOrBefore` is how an overdue queue is asked
 * for, and `asOf` names the day the answer is computed against and is echoed in the result — so a
 * screen says what day it answered for rather than implying "now" and being wrong by one when the
 * request crossed midnight (ADR-0071).
 *
 * **There is no satisfy route.** An assignment is satisfied by a completion or by a certification
 * being issued against it, in the same transaction as the act that earned it. A route that could
 * mark a requirement satisfied on its own would close a compliance obligation with no evidence
 * behind it, and the domain refuses that for the same reason.
 *
 * **Waiving has its own permission and demands a reason.** It is the one act here that excuses
 * somebody from a compliance obligation, and it is the one an auditor asks about a year later.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/assignments', version: '1' })
export class LearningAssignmentController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search assignments. Scoped before it is filtered, and bounded' })
  @ApiOkResponse({
    description:
      'A caller with no resolvable scope receives an empty page rather than a refusal: a count of ' +
      'what was withheld is itself a disclosure.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchAssignments>({
        queryName: 'learning.search-assignments',
        ...paged(query),
        ...optional(query, ['employmentId', 'courseId', 'status', 'dueOnOrBefore', 'asOf']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Assign a course to a person. The employment is confirmed upstream' })
  public async assign(@Body() body: AssignBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignLearningCommand>({
        commandName: 'learning.assign',
        employmentId: body.employmentId,
        courseId: body.courseId,
        ...present({ pathId: body.pathId, dueOn: body.dueOn }),
      }),
    );
  }

  @Post(':assignmentId/waiver')
  @ApiOperation({ summary: 'Excuse somebody from a requirement. Its own permission, and a reason' })
  public async waive(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReasonedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WaiveAssignmentCommand>({
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
      }),
    );
  }

  @Post(':assignmentId/cancellation')
  @ApiOperation({ summary: 'Withdraw a requirement that should not have been made' })
  public async cancel(
    @Param('assignmentId') assignmentId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelAssignmentCommand>({
        commandName: 'learning.cancel-assignment',
        assignmentId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
