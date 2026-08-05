import nest from '@munaxa/config-eslint/nest.js';

import standards from '../../tooling/eslint/standards.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [...nest, ...standards];
