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
 * thing with an identity, so there is nothing to create and nothing to address. **A manager approver
 * and a service-level target joined them in Phase 16C**, on the same body and still on no route of
 * their own — both are properties of a step somebody is configuring.
 *
 * There is still no route here for an escalation, an expiry or a due date, and no body below has a
 * field that could carry one. A target is configuration; nothing fires when it passes.
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
   * the field beside it, and `role` and `external` have no field to arrive in.
   *
   * **A manager is the one kind that is declared**, because it names nobody: `routeToRequestersManager`
   * is a boolean, and the mapping below is the whole of its translation. The controller does not
   * resolve a manager, does not ask Identity or Employment, and could not — resolution happens once,
   * when an instance starts, three layers away from here.
   *
   * The branch configuration and the service-level target travel through untouched: this controller
   * does not read a condition, does not check a quorum against a branch's size, does not resolve a
   * group and computes no due time. Each of those is a fact the domain checks, and the last of them
   * is derived at read time from stored inputs rather than at configuration time at all.
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
          // The boolean becomes the kind here and nowhere else. `false` is not `manager`, so an
          // explicit `false` reads exactly as an omission does rather than as a third state.
          approverKind: body.routeToRequestersManager === true ? ('manager' as const) : undefined,
          branchRule: body.branchRule,
          quorum: body.quorum,
          condition: body.condition,
          serviceLevel: body.serviceLevel,
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
