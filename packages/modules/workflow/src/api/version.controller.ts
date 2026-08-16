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
import { present } from './search-filters.js';
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
 * **Parallel steps, a quorum and a branch condition arrive on the step body since Phase 16B**, and
 * on no route of their own: a branch is a property of the steps that share an ordinal rather than a
 * thing with an identity, so there is nothing to create and nothing to address. There is still no
 * route here for an escalation or an SLA, and no body below has a field that could carry one.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/versions', version: '1' })
export class WorkflowVersionController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  /**
   * Adding a step to a draft.
   *
   * **The kind of approver is derived, never sent.** Naming a group makes it a group step and naming
   * a person makes it a person step; naming both or neither is the domain's refusal with a reason
   * that says which mistake it was. There is no `approverKind` property on the body, so
   * `forbidNonWhitelisted` refuses one outright — a client cannot send a kind that disagrees with
   * the field beside it, and `role` has no field to arrive in.
   *
   * The branch configuration travels through untouched: this controller does not read a condition,
   * does not check a quorum against a branch's size and does not resolve a group. Each of those is a
   * fact about a set of rows the domain checks when the version is published.
   */
  @Post(':workflowVersionId/steps')
  @ApiOperation({ summary: 'Add a step to a draft: a person or a list, and how its branch ends' })
  @ApiUnprocessableEntityResponse({
    description: 'The version is published, or the step names both approvers or neither.',
  })
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
        ...present({
          approverMembershipId: body.approverMembershipId,
          approverGroupId: body.approverGroupId,
          branchRule: body.branchRule,
          quorum: body.quorum,
          condition: body.condition,
        }),
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
