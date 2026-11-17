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
const strictModules = [
  'modules/drafts',
  'modules/custom-fields',
  'modules/auth',
  'modules/pricing',
  'modules/files',
  'modules/theme',
  'modules/payments',
  'modules/webhooks',
]

// Connection-bound modules: their code never imports the shared `db`. Every function that queries takes the `conn`
// (the shared handle or an open transaction) from its caller, so nothing in it can reach `db` by accident. A query on
// `db` inside a transaction waits for that transaction for ever on the embedded database (see modules/db/src/embedded-guard.ts).
// A module joins once none of its functions needs the global; it can still import the `Conn` type and the `schema`.
// (modules/auth is strict but not here: its index.ts hands `db` to Better Auth's adapter, and its setup and sign-up
// functions are entry points called from a form action and from Better Auth's hooks, outside any transaction of ours.)
const connectionBoundModules = [
  'modules/drafts',
  'modules/custom-fields',
  'modules/pricing',
  'modules/files',
  'modules/theme',
  'modules/payments',
  'modules/webhooks',
]

// Server code logs through createLogger from @shopnex/log (levels, LOG_FORMAT=json, redaction), never console.*: every
// module under modules/, the apps (apps/*, which get the logger from @shopnex/app) and the CJ client. Left out: the log
// module itself (it is what writes to the console), `shopnex migrate-db` (its output is the command's own interface),
// and apps/docs (a documentation site). Scripts, the CLIs and the templates are not listed: printing is their job.
const noConsoleFiles = ['modules/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'packages/cj-sdk/src/**/*.ts']
const noConsoleIgnores = ['modules/log/**', 'modules/db/src/migrate-db.ts', 'apps/docs/**']

// First-party apps (apps/stripe, apps/shippo, ...) are built the way a third party builds one: only from the public
// packages below, never from the core modules or their database. That keeps the app contract honest, and an app can then
// move to its own repository without a change. (apps/admin-ui and apps/docs are the product itself, not apps.)
const publicPackages = [
  '@shopnex/app',
  '@shopnex/app-bridge',
  '@shopnex/storefront-sdk',
  '@shopnex/marketplace-sdk',
  // The CJ API client that apps/cj-dropshipping ships with
  '@shopnex/cj-sdk',
]

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
    // A module's router (src/<name>.router.ts) is the caller that hands the shared `db` to the services
    ignores: ['modules/*/src/*.router.ts'],
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
    files: ['apps/*/**/*.{ts,tsx,js,jsx,mjs,astro}'],
    ignores: ['apps/admin-ui/**', 'apps/docs/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@shopnex/*', ...publicPackages.flatMap((name) => [`!${name}`, `!${name}/*`])],
              message: `An app may import only the public packages (${publicPackages.join(', ')}). What it needs from the core belongs in the app API, not in a deep import.`,
            },
            {
              group: ['**/modules/**', '**/packages/**', '**/templates/**'],
              message: 'An app must not import from the repository outside its own folder: use a public package.',
            },
          ],
        },
      ],
    },
  },

  {
    files: noConsoleFiles,
    ignores: noConsoleIgnores,
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          message:
            'Log with the logger: `const log = createLogger("name")` from @shopnex/log (in an app, from @shopnex/app), then `log.error({ err }, "message")`. console.* skips levels, JSON output and redaction.',
        },
      ],
    },
  },

  // Turns off stylistic rules that would fight Prettier; keep last.
  prettier,
)
