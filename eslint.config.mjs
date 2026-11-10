import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig } from 'eslint/config'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { importX } from 'eslint-plugin-import-x'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/*.{js,mjs,cjs}',
      '**/*.config.ts',
      'build/',
      'dist/',
      'out/',
      'evals/',
      '.deepsec/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  importX.flatConfigs.electron,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2015 },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          noWarnOnMultipleProjects: true,
          project: [
            './tsconfig.json',
            './tsconfig.web.json',
            './tsconfig.node.json',
            './packages/cli/tsconfig.json',
          ],
        }),
      ],
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/test-utils'],
              message: 'Test helpers are test-only; do not import them from production code.',
            },
          ],
        },
      ],
    },
  },
  {
    // false-positives on better-sqlite3, whose typings export Database both
    // as the default and as a named member (fires even on type-only imports)
    files: [
      'src/main/storage/**/*.ts',
      'src/main/services/strip-database-for-upload.ts',
      'src/main/services/strip-database-for-upload.test.ts',
      'src/main/services/upload-prep-worker.test.ts',
      'src/main/ui/database-import.ts',
    ],
    rules: { 'import-x/no-named-as-default': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-utils.ts', 'src/main/eval/task-replay.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
)
