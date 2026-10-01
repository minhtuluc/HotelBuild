import { sharedRules } from './base.mjs';

/** Runtime purity only: tests and tooling may use Node, TypeScript and ESLint. */
const forbidden = [
  '@prisma/client',
  '@nestjs/*',
  'node:*',
  'axios',
  'undici',
  'ioredis',
  'redis',
  'bullmq',
  'zod',
  'date-fns-tz',
  '@pinehill/contracts',
  'fs',
];
const selectors = [
  "NewExpression[callee.object.name='globalThis'][arguments.length=0]:matches([callee.property.name='Date'], [callee.property.value='Date'])",
  "MemberExpression[object.object.name='globalThis']:matches([object.property.name='Date'], [object.property.value='Date'], [object.property.name='performance'], [object.property.value='performance']):matches([property.name='now'], [property.value='now'])",
  "MemberExpression[object.object.name='globalThis']:matches([object.property.name='Math'], [object.property.value='Math']):matches([property.name='random'], [property.value='random'])",
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "MemberExpression[object.name='Date']:matches([property.name='now'], [property.value='now'])",
  "MemberExpression[object.name='performance']:matches([property.name='now'], [property.value='now'])",
  "MemberExpression[object.name='Math']:matches([property.name='random'], [property.value='random'])",
  "MemberExpression[object.name='crypto']",
  "MemberExpression[object.name='process']:matches([property.name='env'], [property.value='env'])",
  "MemberExpression[object.type='MetaProperty']:matches([property.name='env'], [property.value='env'])",
  "Identifier[name='window']",
  "Identifier[name='fetch']",
  "Identifier[name='parseFloat']",
  "MemberExpression:matches([property.name='toFixed'], [property.value='toFixed'])",
  "MemberExpression[object.name='globalThis']:matches([property.name='crypto'], [property.value='crypto'], [property.value='fetch'], [property.value='window'], [property.value='parseFloat'])",
  'ImportExpression',
  "CallExpression[callee.name='require']",
];
export const domainRestrictions = [
  {
    files: ['packages/domain/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbidden }],
      'no-restricted-syntax': [
        ...sharedRules['no-restricted-syntax'],
        ...selectors.map((selector) => ({
          selector,
          message: 'Domain must be pure; inject time, IDs and I/O (BR-GEN-01/02/06).',
        })),
      ],
    },
  },
];
