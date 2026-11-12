// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import astro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Strict, type-aware rules, one module at a time. A module joins this list once it passes them; new code in it then has
// to keep passing. (Most of the rest of the repo reports hundreds of findings under these rules today.)
const strictModules = ['modules/drafts', 'modules/custom-fields']

// Connection-bound modules: their code never imports the shared `db`. Every function that queries takes the `conn`
// (the shared handle or an open transaction) from its caller, so nothing in it can reach `db` by accident. A query on
// `db` inside a transaction waits for that transaction for ever on the embedded database (see modules/db/src/embedded-guard.ts).
// A module joins once none of its functions needs the global; it can still import the `Conn` type and the `schema`.
const connectionBoundModules = ['modules/drafts', 'modules/custom-fields']

// Logging goes through createLogger from @shopnex/log (levels, LOG_FORMAT=json, redaction), not console.*. A module joins
// this list once it has no console calls left.
const noConsoleModules = ['modules/payments', 'modules/email']

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/.astro/',
    '**/dist/',
    '**/out/',
    '**/.source/',
    '**/build/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '**/next-env.d.ts',
    // Built by templates/storefront/scripts/themes.mjs
    'templates/storefront/themes/*/assets/',
    'templates/storefront/built/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: strictModules.map((dir) => `${dir}/src/**/*.ts`),
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Warnings elsewhere, errors here: no escape hatches in the modules that opted in
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    files: connectionBoundModules.map((dir) => `${dir}/src/**/*.ts`),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@shopnex/db',
              importNames: ['db'],
              message:
                'Take a `conn: Conn` parameter instead of importing the shared `db`: inside a transaction a query on `db` freezes the embedded database. The caller passes `db` or its `tx`.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='@shopnex/db'] > ImportNamespaceSpecifier",
          message:
            'Import what you need by name (`schema`, `Conn`): a namespace import would bring the shared `db` in.',
        },
      ],
    },
  },

  {
    // Modules that log through @shopnex/log (modules/log is the one place that writes to the console)
    files: noConsoleModules.map((dir) => `${dir}/src/**/*.ts`),
    rules: {
      'no-console': ['error'],
    },
  },

  // Turns off stylistic rules that would fight Prettier; keep last.
  prettier,
)
