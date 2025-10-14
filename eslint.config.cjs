// Flat ESLint config for ESLint v9+
// Migrated from previous .eslintrc.cjs

const tsProjectConfigs = [
  './tsconfig.app.json',
  './tsconfig.background.json',
  './tsconfig.harness.json'
];

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'out-tsc/**',
      '**/*.spec.ts',
      '**/*.bg-spec.ts', // background spec naming pattern
      'src/test.ts' // Angular test bootstrap (handled by Angular CLI test config)
    ]
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: tsProjectConfigs,
        sourceType: 'module',
        ecmaVersion: 'latest'
      }
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      '@angular-eslint': require('@angular-eslint/eslint-plugin'),
      '@angular-eslint/template': require('@angular-eslint/eslint-plugin-template')
    },
    linterOptions: {
      // During initial adoption we suppress reports for stale disable comments to avoid noise.
      reportUnusedDisableDirectives: false
    },
    rules: {
      // Base adjustments
      // (Phase 1) Make console usage permissible; can tighten later per folder if desired.
      'no-console': 'off',
      // (Phase 1) Relax strict async enforcement until codebase is refactored; treat as informational.
      '@typescript-eslint/no-floating-promises': 'warn',
      // (Phase 1) Defer import style normalization to reduce churn during migration.
      '@typescript-eslint/consistent-type-imports': 'off',
      // (Phase 1) Allow any temporarily; will create a focused ticket to narrow surfaces.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  // Angular specific (template processing for inline templates)
  // Inline template processing: use the template plugin's processor
  {
    files: ['src/app/**/*.ts'],
    processor: '@angular-eslint/template/extract-inline-html'
  },
  // Background folder override (allow console fully if desired)
  {
    files: ['src/background/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  // Test overrides
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off'
    }
  }
];
