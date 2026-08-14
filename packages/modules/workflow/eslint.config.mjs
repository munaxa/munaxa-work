import base from '@munaxa/config-eslint/base.js';

import standards from '../../../tooling/eslint/standards.mjs';

/**
 * Enterprise Workflow & Approvals.
 *
 * No exemption is declared. The domain layer this package currently holds is pure functions over
 * immutable state with no environment, no clock and no database in it, so there is nothing for an
 * exemption to be for. An integration fixture that needs one arrives with the checkpoint that needs
 * it, and not before.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [...base, ...standards];
