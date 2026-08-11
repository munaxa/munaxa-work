import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RespondToAssignmentCommand } from '../application/review.use-case.js';
import type { AssignmentStatus } from '../domain/performance-vocabulary.js';

import { RespondToAssignmentBody } from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/** Accepting or declining an invitation. The reviewer's own act, on their own assignment. */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/reviewer-assignments', version: '1' })
export class PerformanceReviewerAssignmentController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':reviewerAssignmentId/response')
  @ApiOperation({ summary: 'Accept or decline an invitation to review' })
  public async respond(
    @Param('reviewerAssignmentId') reviewerAssignmentId: string,
    @Body() body: RespondToAssignmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RespondToAssignmentCommand>({
        commandName: 'performance.respond-to-assignment',
        reviewerAssignmentId,
        ...body,
        status: body.status as AssignmentStatus,
      }),
    );
  }
}
