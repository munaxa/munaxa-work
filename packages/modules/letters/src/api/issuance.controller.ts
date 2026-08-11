import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CancelLetterCommand } from '../application/letter-request.use-case.js';
import type { IssueLetterCommand } from '../application/letter-issue.use-case.js';

import { CancelLetterBody, IssueLetterBody } from './letters.dto.js';
import { LettersDispatcher } from './letters-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Issuing a letter, and cancelling a request.
 *
 * Both routes carry a `:letterRequestId` segment, so this controller is registered after
 * `LetterRequestController` — Nest resolves by declaration order.
 *
 * Issuance is where everything is frozen: the template version, every substituted value, the
 * locale, and the version of each source the values came from. **No file is produced**, because no
 * renderer exists in this repository (D-15), and nothing claims a signature, because no provider
 * exists (D-16).
 */
@ApiTags('letters')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'letters/requests', version: '1' })
export class LetterIssuanceController {
  public constructor(private readonly dispatcher: LettersDispatcher) {}

  @Post(':letterRequestId/issue')
  @ApiOperation({ summary: 'Generate and issue. What the letter says is frozen at this moment' })
  @ApiOkResponse({
    description:
      'Returns the generated body and a reference number. **No file is produced** — no renderer ' +
      'exists in this repository, so an issued letter carries its content and no artefact.',
  })
  public async issue(
    @Param('letterRequestId') letterRequestId: string,
    @Body() body: IssueLetterBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, IssueLetterCommand>({
        commandName: 'letters.issue',
        letterRequestId,
        ...body,
      }),
    );
  }

  @Post(':letterRequestId/cancel')
  @ApiOperation({ summary: 'Cancel a request. An issued letter is terminal and is not reachable' })
  public async cancel(
    @Param('letterRequestId') letterRequestId: string,
    @Body() body: CancelLetterBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelLetterCommand>({
        commandName: 'letters.cancel',
        letterRequestId,
        ...body,
      }),
    );
  }
}
