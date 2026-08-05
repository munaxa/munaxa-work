import base from '@munaxa/config-eslint/base.js';

import standards from '../../tooling/eslint/standards.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [...base, ...standards];
