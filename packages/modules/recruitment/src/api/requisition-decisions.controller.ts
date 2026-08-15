import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { SubmitRequisitionCommand } from '../application/requisition.use-case.js';
import type {
  DecideRequisitionCommand,
  ReverseRequisitionDecisionCommand,
} from '../application/requisition-decision.use-case.js';
import type {
  CloseRequisitionCommand,
  OpenRequisitionCommand,
} from '../application/requisition-lifecycle.use-case.js';

import {
  CloseRequisitionBody,
  DecideRequisitionBody,
  ReverseDecisionBody,
  VersionedBody,
} from './requisition.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What happens to a requisition after it is raised.
 *
 * **The decider is never in the body.** It comes from the authenticated context, so nobody can
 * record an approval in a colleague's name — and a decision is never amended: the reversal endpoint
 * writes a new row naming the one it reverses (ADR-0045).
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such requisition in this tenant.' })
@ApiConflictResponse({ description: 'The version supplied is not the version stored.' })
@Controller({ path: 'recruitment/requisitions', version: '1' })
export class RequisitionDecisionsController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Post(':requisitionId/submission')
  @ApiOperation({ summary: 'Submit a draft requisition for decision' })
  public async submit(
    @Param('requisitionId') requisitionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitRequisitionCommand>({
        commandName: 'recruitment.submit-requisition',
        requisitionId,
        ...body,
      }),
    );
  }

  @Post(':requisitionId/decision')
  @ApiOperation({ summary: 'Approve or reject. Requires recruitment.requisition.approve' })
  @ApiOkResponse({ description: 'The decision is recorded against the authenticated human.' })
  public async decide(
    @Param('requisitionId') requisitionId: string,
    @Body() body: DecideRequisitionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideRequisitionCommand>({
        commandName: 'recruitment.decide-requisition',
        requisitionId,
        ...body,
      }),
    );
  }

  @Post(':requisitionId/decision/reversal')
  @ApiOperation({ summary: 'Reverse the last decision. A new row, never an edit' })
  public async reverse(
    @Param('requisitionId') requisitionId: string,
    @Body() body: ReverseDecisionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReverseRequisitionDecisionCommand>({
        commandName: 'recruitment.reverse-requisition-decision',
        requisitionId,
        ...body,
      }),
    );
  }

  @Post(':requisitionId/opening')
  @ApiOperation({ summary: 'Open an approved requisition for recruiting' })
  public async open(
    @Param('requisitionId') requisitionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, OpenRequisitionCommand>({
        commandName: 'recruitment.open-requisition',
        requisitionId,
        ...body,
      }),
    );
  }

  @Post(':requisitionId/closure')
  @ApiOperation({ summary: 'Close a requisition, or cancel it' })
  public async close(
    @Param('requisitionId') requisitionId: string,
    @Body() body: CloseRequisitionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseRequisitionCommand>({
        commandName: 'recruitment.close-requisition',
        requisitionId,
        ...body,
      }),
    );
  }
}
