import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [
  {
    ignores: [
      '.next/**',
      // Build output of the real-backend e2e suite (`NEXT_DIST_DIR`), and its reports.
      '.next-real/**',
      'node_modules/**',
      'public/**',
      'src/contracts/**',
      'playwright-report/**',
      'playwright-report-real/**',
      'test-results/**',
      'test-results-real/**',
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
