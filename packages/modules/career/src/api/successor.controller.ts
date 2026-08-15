import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ConfirmSuccessorCommand,
  WithdrawSuccessorCommand,
} from '../application/successor.use-case.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { WithdrawSuccessorBody } from './career-people.dto.js';
import { VersionedBody } from './career.dto.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What happens to a nomination after it is made.
 *
 * Its own prefix because a nomination is addressed by its own identifier once it exists, and because
 * the two acts here are governed differently from the act that created it.
 *
 * **Confirming is not nominating, and it has its own permission.** Suggesting somebody could succeed
 * a director is one thing; recording that the organization agrees is the act an auditor asks about a
 * year later. `career.successor.confirm` is held separately from `career.successor.nominate`, and no
 * route here treats one as implying the other.
 *
 * **Confirmation is a named human act.** `system:auto-approval` is refused by a check constraint in
 * the database, not merely by a rule up here — there is no approval workflow to stand in for a
 * person, and there is no route on this controller that could invoke one.
 *
 * **Withdrawal is a state and never a delete.** "We put this person forward and then took them off
 * the list" is exactly the history a succession review needs.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/successors', version: '1' })
export class CareerSuccessorController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Post(':successorId/confirmation')
  @ApiOperation({ summary: 'Record that the organization agrees. Its own permission' })
  public async confirm(
    @Param('successorId', ParseUUIDPipe) successorId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ConfirmSuccessorCommand>({
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':successorId/withdrawal')
  @ApiOperation({ summary: 'Take somebody off the bench, with a reason. Not a deletion' })
  public async withdraw(
    @Param('successorId', ParseUUIDPipe) successorId: string,
    @Body() body: WithdrawSuccessorBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WithdrawSuccessorCommand>({
        commandName: 'career.withdraw-successor',
        successorId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
