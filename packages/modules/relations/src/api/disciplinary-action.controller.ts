import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IssueDisciplinaryActionCommand } from '../application/disciplinary-action.use-case.js';
import type {
  ReadApplicableAction,
  ReadDisciplinaryAction,
} from '../application/disciplinary-queries.js';

import { IssueDisciplinaryActionBody } from './relations.dto.js';
import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What the ladder prescribes for one case, and what was actually issued on it.
 *
 * **Two routes, and the difference between them is the whole of D-5.2-20.** `GET …/applicable`
 * reports what the tenant's configuration says; `POST …/action` records what a named human decided.
 * The first writes nothing and the second is the only thing that does.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/cases', version: '1' })
export class DisciplinaryActionController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get(':violationId/applicable-action')
  @ApiOperation({ summary: "What the tenant's ladder prescribes for this case" })
  @ApiOkResponse({
    description:
      'Decision support. Derived at read time, writes nothing, and returns no action where the ' +
      'tenant has configured no rule.',
  })
  public async applicable(@Param('violationId') violationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApplicableAction>({
        queryName: 'relations.applicable-action',
        violationId,
      }),
    );
  }

  @Get(':violationId/action')
  @ApiOperation({ summary: 'The disciplinary action issued on this case' })
  public async action(@Param('violationId') violationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDisciplinaryAction>({
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );
  }

  /**
   * A `POST` to a named act, not a `PATCH` of a state field.
   *
   * The request is *"issue this action on this case, and here is why"* — not *"set this case to
   * action_issued"*. The second shape would invite a caller to set any state they liked, and the
   * case's movement is this act's consequence rather than its instruction.
   */
  @Post(':violationId/action')
  @ApiOperation({ summary: 'Issue a disciplinary action on a case with concluded findings' })
  @ApiOkResponse({
    description:
      'Records a decision. Suspends nobody, ends no employment, deducts no pay and starts no ' +
      'approval — the two most serious actions are recommendations another module executes.',
  })
  public async issue(
    @Param('violationId') violationId: string,
    @Body() body: IssueDisciplinaryActionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, IssueDisciplinaryActionCommand>({
        commandName: 'relations.issue-disciplinary-action',
        violationId,
        ...body,
      }),
    );
  }
}
