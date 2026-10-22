// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import astro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/.astro/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '**/next-env.d.ts',
    // Built by templates/storefront/scripts/themes.mjs
    'templates/storefront/themes/*/assets/',
    'templates/storefront/public/shopnex/',
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

  // Turns off stylistic rules that would fight Prettier; keep last.
  prettier,
)
