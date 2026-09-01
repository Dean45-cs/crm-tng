import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` deckt nur den Vite-Build im Wurzelverzeichnis ab — desktop/dist ist
  // das gepackte Electron-Bundle und enthält eine vollständige Kopie von
  // extension/, die sonst doppelt (und veraltet) mitgeprüft würde.
  globalIgnores(['dist', '**/dist/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Die Extension (extension/) und die Desktop-App (desktop/) sind klassisches
  // JavaScript ohne Build-Schritt: CommonJS im Electron-Hauptprozess, IIFEs mit
  // chrome.*-Globals in den Content-Scripts. Ohne diesen Block fielen sie auf
  // ESM zurück, womit `npm run lint` am ersten `require`/Top-Level-`return`
  // scheiterte und für das ganze Repo abbrach (statt die TS-Dateien zu prüfen).
  {
    files: ['**/*.js'],
    // Die Konfigurationsdateien im Wurzelverzeichnis sind ESM ("type": "module"
    // in package.json) und dürfen nicht als CommonJS geparst werden.
    ignores: ['*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
    rules: {
      // In diesem Code steht ein leerer catch-Block für "bewusst ignorieren"
      // (Extension-Kontext weg, Worker beendet) — die gebundene Variable bleibt
      // dabei absichtlich ungenutzt.
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
    },
  },
])
