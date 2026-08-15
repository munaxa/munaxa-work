import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  DefineMandatoryRuleCommand,
  RetireMandatoryRuleCommand,
} from '../application/mandatory-rule.use-case.js';
import type { ReconcileRequirementsCommand } from '../application/reconcile.use-case.js';
import type { ListMandatoryRules } from '../application/learning-queries.js';
import type { AudienceKind, MandatoryKind } from '../domain/learning-vocabulary.js';

import { DefineMandatoryRuleBody, ReconcileBody, VersionedBody } from './learning.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { flag, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What a tenant made mandatory, of whom, and the command that acts on it.
 *
 * **Reconciliation is a command somebody sends, and it is a `POST` to a sub-resource because it
 * writes.** Nothing in this repository schedules it: `JobPort` has no adapter anywhere, so a route
 * that implied nightly execution would be a promise the product cannot keep. Scheduled
 * reconciliation is `NOT VERIFIED`, and an administrator — or an operator's own scheduler calling
 * this route — is what actually runs it.
 *
 * **It is bounded and idempotent.** One call examines one page of the audience and says whether
 * more remain; a repeat generates nothing new, because the occurrence a requirement belongs to is
 * arbitrated by a unique index rather than by a read-then-write (ADR-0071). Retrying a call that
 * timed out is therefore safe, which is the property that makes it usable at all.
 *
 * **A dependency that cannot answer is a refusal, never a zero.** If Employment cannot resolve the
 * audience, this returns 422 rather than reporting "0 examined, 0 generated" — a compliance report
 * claiming everybody is up to date about an organization it never looked at is the one outcome
 * worse than an error.
 *
 * Retiring a rule stops it implying anything new and leaves what it already implied alone: "was
 * this person asked to do fire safety in 2024" has an answer, and it stays answered.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/mandatory-rules', version: '1' })
export class LearningMandatoryRuleController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'List mandatory rules. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListMandatoryRules>({
        queryName: 'learning.list-mandatory-rules',
        ...paged(query),
        ...flag(query, 'activeOnly'),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a requirement. The unit is confirmed through Organization' })
  @ApiUnprocessableEntityResponse({
    description:
      'The course is not published, or the audience names a unit Organization does not know. A ' +
      'rule covering nobody is worse than no rule at all.',
  })
  public async define(@Body() body: DefineMandatoryRuleBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineMandatoryRuleCommand>({
        commandName: 'learning.define-mandatory-rule',
        courseId: body.courseId,
        name: body.name,
        kind: body.kind as MandatoryKind,
        audience: body.audience as AudienceKind,
        effectiveFrom: body.effectiveFrom,
        recurrenceMonths: body.recurrenceMonths,
        dueWithinDays: body.dueWithinDays,
        ...present({
          organizationUnitId: body.organizationUnitId,
          positionId: body.positionId,
        }),
      }),
    );
  }

  @Post(':mandatoryRuleId/retirement')
  @ApiOperation({ summary: 'Retire a rule. What it already asked of people is left alone' })
  public async retire(
    @Param('mandatoryRuleId') mandatoryRuleId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetireMandatoryRuleCommand>({
        commandName: 'learning.retire-mandatory-rule',
        mandatoryRuleId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':mandatoryRuleId/reconciliation')
  @ApiOperation({
    summary: 'Reconcile one page of the audience. Bounded, idempotent, never scheduled',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The rule is retired, or a dependency could not answer. Never reported as zero.',
  })
  public async reconcile(
    @Param('mandatoryRuleId') mandatoryRuleId: string,
    @Body() body: ReconcileBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReconcileRequirementsCommand>({
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
        ...present({ limit: body.limit, page: body.page }),
      }),
    );
  }
}
