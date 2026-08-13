import base from '@munaxa/config-eslint/base.js';

import standards from '../../../tooling/eslint/standards.mjs';

/**
 * Career & Succession.
 *
 * No override yet. The exemption Learning carries — `process.env` inside an integration fixture —
 * is added when this module gains one, and not before: a rule relaxed in advance of the code that
 * needs it is a rule nobody notices has been relaxed.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [...base, ...standards];
