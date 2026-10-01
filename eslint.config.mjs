import {
  typescriptConfig,
  javascriptConfig,
  ignoredPatterns,
} from '@pinehill/config/eslint/base.mjs';
import {
  frontendRestrictions,
  environmentRestrictions,
} from '@pinehill/config/eslint/frontend.mjs';

import { domainRestrictions } from '@pinehill/config/eslint/domain.mjs';

export default [
  { ignores: ignoredPatterns },
  ...javascriptConfig(),
  ...typescriptConfig(import.meta.dirname),
  ...frontendRestrictions,
  ...environmentRestrictions,
  ...domainRestrictions,
];
