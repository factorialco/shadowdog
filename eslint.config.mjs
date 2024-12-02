import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.Config[]} */
export default [
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'] },
  { ignores: ['**/*.js', '**/*.d.ts', '**/*.mjs'] },
  { rules: { 'no-shadow': 'error' } },
]
