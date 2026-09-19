import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'src/contracts/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'next-env.d.ts',
      '.cache/**',
    ],
  },
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  { files: ['scripts/**', 'e2e/**', '**/*.test.*'], rules: { 'no-console': 'off' } },
];

export default config;
