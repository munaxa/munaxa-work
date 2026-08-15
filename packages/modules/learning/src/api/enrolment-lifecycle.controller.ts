import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  CompleteEnrolmentCommand,
  StartEnrolmentCommand,
} from '../application/enrolment.use-case.js';
import type { EndEnrolmentCommand } from '../application/enrolment-ending.use-case.js';

import { VersionedBody } from './learning.dto.js';
import { CompleteEnrolmentBody, EndEnrolmentBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The four moves an enrolment can make, each a `POST` to its own sub-resource.
 *
 * **None of them is a `PATCH` of a status field**, and that is the whole design of this controller.
 * Starting, completing, failing and withdrawing are four different acts with four different rules
 * — completing requires a passed assessment where the pinned course version demands one, and it
 * needs `enrolment.complete`, which `enrolment.manage` does not imply. A writable `status` would
 * collapse all of that into whatever string a client happened to send.
 *
 * **A completion carries the day it happened**, not the day it was typed. The two differ whenever
 * an administrator catches up on a backlog, and an expiry derived from the wrong one is a licence
 * that lapses on the wrong date.
 *
 * A completion **closes the requirement it came from in the same transaction**, which is why there
 * is no separate satisfy route on assignments: satisfaction follows evidence, and a route that
 * could produce it without the evidence would close a compliance obligation on nothing at all.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/enrolments', version: '1' })
export class LearningEnrolmentLifecycleController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Post(':enrolmentId/start')
  @ApiOperation({ summary: 'Record that somebody began' })
  public async start(
    @Param('enrolmentId') enrolmentId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, StartEnrolmentCommand>({
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':enrolmentId/completion')
  @ApiOperation({ summary: 'Record that somebody finished, on the day they finished' })
  public async complete(
    @Param('enrolmentId') enrolmentId: string,
    @Body() body: CompleteEnrolmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CompleteEnrolmentCommand>({
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: body.expectedVersion,
        completedOn: body.completedOn,
        ...present({ outcomeNote: body.outcomeNote }),
      }),
    );
  }

  @Post(':enrolmentId/failure')
  @ApiOperation({ summary: 'End an enrolment unsuccessfully. Not a completion' })
  public async fail(
    @Param('enrolmentId') enrolmentId: string,
    @Body() body: EndEnrolmentBody,
  ): Promise<unknown> {
    return this.end('learning.fail-enrolment', enrolmentId, body);
  }

  @Post(':enrolmentId/withdrawal')
  @ApiOperation({ summary: 'Take somebody off a course. Not a failure and not a completion' })
  public async withdraw(
    @Param('enrolmentId') enrolmentId: string,
    @Body() body: EndEnrolmentBody,
  ): Promise<unknown> {
    return this.end('learning.withdraw-enrolment', enrolmentId, body);
  }

  /**
   * The two endings, which differ only in which one they are.
   *
   * Shared because the transport is identical and the *meaning* is not: failing says somebody tried
   * and did not pass, withdrawing says they stopped. Both are named on the wire so a record says
   * which happened, and neither closes the requirement the enrolment came from.
   */
  private async end(
    commandName: EndEnrolmentCommand['commandName'],
    enrolmentId: string,
    body: EndEnrolmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EndEnrolmentCommand>({
        commandName,
        enrolmentId,
        expectedVersion: body.expectedVersion,
        ...present({ note: body.note }),
      }),
    );
  }
}
