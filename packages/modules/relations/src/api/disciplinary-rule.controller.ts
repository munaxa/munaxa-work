import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendDisciplinaryRuleCommand,
  DefineDisciplinaryRuleCommand,
} from '../application/disciplinary-ladder.use-case.js';
import type { ListDisciplinaryRules } from '../application/disciplinary-queries.js';

import { AmendDisciplinaryRuleBody, DefineDisciplinaryRuleBody } from './relations.dto.js';
import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The tenant's disciplinary ladder — configuration, on its own path.
 *
 * **Separate from the case routes deliberately.** Configuring what a third absence attracts and
 * disciplining somebody are different acts by different people, and the paths say so: this prefix
 * carries no violation identifier and its reads name nobody.
 *
 * **Nothing here issues anything.** Writing a rule prescribes; it does not punish, does not
 * re-evaluate existing cases and does not touch a record. Issuing is a separate route with a
 * separate permission.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/disciplinary-rules', version: '1' })
export class DisciplinaryRuleController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get()
  @ApiOperation({ summary: "One category's configured ladder, most specific rung first" })
  @ApiOkResponse({ description: 'Configuration. Names nobody, and claims no legal validity.' })
  public async rules(
    @Query('violationCategoryId') violationCategoryId: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListDisciplinaryRules>({
        queryName: 'relations.disciplinary-rules',
        violationCategoryId,
        ...(includeInactive === undefined ? {} : { includeInactive: includeInactive === 'true' }),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Configure what an occurrence of a category attracts' })
  public async define(@Body() body: DefineDisciplinaryRuleBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineDisciplinaryRuleCommand>({
        commandName: 'relations.define-disciplinary-rule',
        ...body,
      }),
    );
  }

  /**
   * `POST`, not `PATCH` — matching `relations.amend-category` and the module-wide rule that no
   * route uses `PUT`, `PATCH` or `DELETE`. A verb implying in-place replacement invites the attempt
   * to delete a rung, and a rung that prescribed an action somebody was issued must never vanish.
   */
  @Post(':disciplinaryRuleId')
  @ApiOperation({ summary: 'Amend a rung, or take it out of service' })
  public async amend(
    @Param('disciplinaryRuleId') disciplinaryRuleId: string,
    @Body() body: AmendDisciplinaryRuleBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendDisciplinaryRuleCommand>({
        commandName: 'relations.amend-disciplinary-rule',
        disciplinaryRuleId,
        ...body,
      }),
    );
  }
}
