import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  ArchiveVersionCommand,
  PublishVersionCommand,
} from '../application/definition.use-case.js';
import type { AddStepCommand } from '../application/step.use-case.js';

import { AddStepBody, VersionedBody } from './workflow.dto.js';
import { WorkflowDispatcher } from './workflow-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * A version of a definition, while it is still editable — and the two acts that end that.
 *
 * **Publication is the moment a version stops being editable and starts being followed**, which is
 * why it is a `POST` to its own sub-resource with its own refusals rather than a status somebody
 * sets. A version with no steps publishes nothing, because a process with nothing to approve would
 * complete instantly while looking like a control; and a version whose ordinals are not contiguous
 * from one publishes nothing either, because "the next step" would be ambiguous at the one moment
 * nobody is watching.
 *
 * **Steps are added here and nowhere else, and only to a draft.** There is no route that edits a
 * published version's steps, no route that removes one, and no route that reorders them: an instance
 * copies its steps at creation, so a version somebody could edit afterwards would change the
 * meaning of approvals already under way (AD-003).
 *
 * There is no route here for parallel steps, a quorum, a branch condition or an escalation, and no
 * body below has a field that could carry one.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/versions', version: '1' })
export class WorkflowVersionController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  @Post(':workflowVersionId/steps')
  @ApiOperation({ summary: 'Add a step to a draft. One membership, one position in the chain' })
  @ApiUnprocessableEntityResponse({ description: 'The version is published or archived.' })
  public async addStep(
    @Param('workflowVersionId', ParseUUIDPipe) workflowVersionId: string,
    @Body() body: AddStepBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddStepCommand>({
        commandName: 'workflow.add-step',
        workflowVersionId,
        ordinal: body.ordinal,
        name: body.name,
        approverMembershipId: body.approverMembershipId,
      }),
    );
  }

  @Post(':workflowVersionId/publication')
  @ApiOperation({ summary: 'Publish a version. It becomes immutable and instances follow it' })
  @ApiConflictResponse({ description: 'The version changed since it was read.' })
  @ApiUnprocessableEntityResponse({ description: 'It has no steps, or its order is broken.' })
  public async publish(
    @Param('workflowVersionId', ParseUUIDPipe) workflowVersionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishVersionCommand>({
        commandName: 'workflow.publish-version',
        workflowVersionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':workflowVersionId/archive')
  @ApiOperation({ summary: 'Archive a version. New approvals stop choosing it; running ones stay' })
  @ApiConflictResponse({ description: 'The version changed since it was read.' })
  public async archive(
    @Param('workflowVersionId', ParseUUIDPipe) workflowVersionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchiveVersionCommand>({
        commandName: 'workflow.archive-version',
        workflowVersionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
