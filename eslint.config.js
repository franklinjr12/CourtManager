import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.config.ts', 'tests/**'],
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      'import/order': [
        'warn',
        { alphabetize: { order: 'asc', caseInsensitive: true } },
      ],
    },
  },
];
