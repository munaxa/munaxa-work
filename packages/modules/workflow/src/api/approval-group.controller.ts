import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadApprovalGroup, SearchApprovalGroups } from '../application/group-queries.js';
import type {
  AddGroupMemberCommand,
  CreateApprovalGroupCommand,
  RemoveGroupMemberCommand,
} from '../application/approval-group.use-case.js';

import { AddGroupMemberBody, CreateApprovalGroupBody } from './workflow.dto.js';
import { WorkflowDispatcher } from './workflow-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The lists a tenant keeps of who approves what.
 *
 * **This is not a directory, and the whole surface is shaped by that.** A directory answers "who
 * holds role X" — a question about people, evaluated whenever it is asked, against facts somebody
 * else owns; ADR-0001 places that with Platform and this product has committed not to build it. What
 * these five routes expose is the opposite: a list somebody wrote down, kept in Workflow's own
 * tables, with no query behind it, no nesting, no inheritance and no role semantics.
 *
 * So there is no route here that takes a role, a manager, a position or an employment; none that
 * resolves a membership through Identity; and none that answers "which lists is this person on" —
 * that last is the first question a directory answers, and there is no application handler for it.
 *
 * **A group has no lifecycle**, so there is no activate, no archive, no status and no route that
 * could set one. A list nobody wants any more has its members removed.
 *
 * **Removing a member is a `DELETE` on the member rather than on a nested path**, and the shape is
 * deliberate. The application's command takes one identifier — the membership row — so a
 * `/approval-groups/:groupId/members/:memberId` route would put a group in the URL that nothing
 * verifies, and a caller naming group A while removing group B's member would be told they had done
 * what the URL said. Adding it is nested, because the group *is* the command's own field there.
 *
 * **Two permissions, and neither implies the other.** Reading who approves capital expenditure and
 * being able to change who approves it are different risks, and neither is implied by
 * `workflow.definition.manage` — whoever edits a list changes the outcome of every approval started
 * from a version that names it.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/approval-groups', version: '1' })
export class WorkflowApprovalGroupController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search the approval groups a tenant keeps. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchApprovalGroups>({
        queryName: 'workflow.search-approval-groups',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Name a list. It starts empty, and a version may not use an empty one' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreateApprovalGroupBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateApprovalGroupCommand>({
        commandName: 'workflow.create-approval-group',
        code: body.code,
        name: body.name,
      }),
    );
  }

  @Get(':approvalGroupId')
  @ApiOperation({ summary: 'One list with the memberships on it, in a deterministic order' })
  @ApiNotFoundResponse({ description: 'No such group in this tenant.' })
  public async read(
    @Param('approvalGroupId', ParseUUIDPipe) approvalGroupId: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApprovalGroup>({
        queryName: 'workflow.read-approval-group',
        approvalGroupId,
      }),
    );
  }

  @Post(':approvalGroupId/members')
  @ApiOperation({ summary: 'Put a membership on the list. Nothing resolves it through Identity' })
  @ApiConflictResponse({ description: 'That membership is already on this group.' })
  public async addMember(
    @Param('approvalGroupId', ParseUUIDPipe) approvalGroupId: string,
    @Body() body: AddGroupMemberBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddGroupMemberCommand>({
        commandName: 'workflow.add-group-member',
        approvalGroupId,
        membershipId: body.membershipId,
      }),
    );
  }

  /**
   * Taking somebody off a list.
   *
   * It reaches nothing already running: every approval under way holds its own copy of the approvers
   * it started with, so somebody removed today keeps the step they were asked to decide yesterday —
   * which is the honest outcome, because they *were* asked and the timeline says so.
   */
  @Delete('members/:approvalGroupMemberId')
  @ApiOperation({ summary: 'Take a membership off a list. It reaches no approval already running' })
  @ApiNotFoundResponse({ description: 'No such membership row in this tenant.' })
  public async removeMember(
    @Param('approvalGroupMemberId', ParseUUIDPipe) approvalGroupMemberId: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RemoveGroupMemberCommand>({
        commandName: 'workflow.remove-group-member',
        approvalGroupMemberId,
      }),
    );
  }
}
