import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/**', 'data/**', '**/*.min.js'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'always'],
      'no-var': 'warn',
      'no-duplicate-imports': 'error',
      'no-template-curly-in-string': 'warn',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      curly: ['warn', 'multi-line'],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Project-specific globals (classes/functions defined in other files)
        ChatUI: 'readonly',
        WebSocketClient: 'readonly',
        TerminalManager: 'readonly',
        App: 'readonly',
        renderMarkdown: 'readonly',
        // External libraries loaded via CDN
        marked: 'readonly',
        hljs: 'readonly',
        Terminal: 'readonly',
        FitAddon: 'readonly',
      },
    },
  },
  {
    files: ['gateway.js', 'src/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  eslintConfigPrettier,
];
