import tseslint from 'typescript-eslint';

/** Thư mục không thuộc phạm vi lint sản phẩm (tài liệu/công cụ kiểm tài liệu có CI riêng). */
export const ignoredPatterns = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.expo/**',
  '**/coverage/**',
  'docs/**',
  'scripts/**',
  'tests/**',
  '**/next-env.d.ts',
  '**/expo-env.d.ts',
];

/**
 * Quy tắc không cần thông tin kiểu — áp cho cả TS/TSX và JS/MJS.
 * Nguồn: docs/05-ke-hoach/quy-tac-ky-thuat.md §2, §9.
 */
export const sharedRules = {
  'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
  complexity: ['error', 10],
  'max-depth': ['error', 4],
  'no-console': ['error', { allow: ['warn', 'error'] }],
  'no-restricted-globals': [
    'error',
    { name: 'parseFloat', message: 'Cấm số thực cho tiền; dùng số nguyên VND (BR-GEN-01).' },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  // QT §2: cấm ép kiểu `as`, chỉ cho type guard và `as const`.
  'no-restricted-syntax': [
    'error',
    {
      selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
      message: 'Cấm `as`; dùng type guard/parse zod, hoặc `as const` (QT §2).',
    },
  ],
  '@typescript-eslint/naming-convention': [
    'error',
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
    { selector: 'classMethod', format: ['camelCase'] },
    { selector: 'function', format: ['camelCase', 'PascalCase'] },
    { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
  ],
};

/** Quy tắc cần thông tin kiểu (typed lint) — chỉ áp cho file TS/TSX có project. */
export const typedRules = {
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
};

export const plugin = tseslint.plugin;
export const parser = tseslint.parser;

function languageOptions(tsconfigRootDir) {
  return {
    parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir,
      allowDefaultProject: [],
    },
  };
}

/** Cấu hình cho mã TypeScript (type-aware). */
export function typescriptConfig(tsconfigRootDir) {
  return [
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: languageOptions(tsconfigRootDir),
      plugins: { '@typescript-eslint': plugin },
      rules: { ...sharedRules, ...typedRules },
    },
  ];
}

/** Cấu hình cho mã JS/MJS/CJS (không type-aware). */
export function javascriptConfig() {
  return [
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
      rules: { 'max-lines': ['error', 400], complexity: ['error', 10] },
    },
  ];
}
