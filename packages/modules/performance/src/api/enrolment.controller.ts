import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { EnrolParticipantsCommand } from '../application/enrolment.use-case.js';

import { EnrolParticipantsBody } from './goal.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Filling a cycle with the people it will review.
 *
 * **Employments are resolved through Employment's published contract**, never from a list a client
 * asserted is a team. Naming employments explicitly is permitted — that is a list of subjects, not a
 * claim about who manages them — and each is confirmed active as of the enrolment before a review
 * exists for it.
 *
 * Enrolment is **re-runnable**: an employment already enrolled is skipped rather than duplicated,
 * which is what makes recovering from a half-finished enrolment a matter of running it again rather
 * than a cleanup nobody wants to do by hand.
 *
 * On its own controller because it is the one route on a cycle that reaches outside this module, and
 * because Nest resolves routes by declaration order — a controller owning `:cycleId/participants`
 * declared beside the lifecycle routes reads as an afterthought rather than as the boundary it is.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/cycles', version: '1' })
export class PerformanceEnrolmentController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':cycleId/participants')
  @ApiOperation({ summary: 'Enrol employments, or everybody in a unit. Re-runnable' })
  @ApiOkResponse({
    description:
      'Employment confirms each one is active as of the enrolment. An employment already ' +
      'enrolled is skipped rather than duplicated.',
  })
  public async enrol(
    @Param('cycleId') cycleId: string,
    @Body() body: EnrolParticipantsBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EnrolParticipantsCommand>({
        commandName: 'performance.enrol-participants',
        cycleId,
        ...present({
          employmentIds: body.employmentIds,
          organizationUnitId: body.organizationUnitId,
        }),
      }),
    );
  }
}
