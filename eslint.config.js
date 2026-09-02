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
  // `.claude/worktrees` enthält Git-Worktrees — vollständige Kopien des Repos
  // samt eigener eslint.config.js. ESLint sucht die Config je Datei von unten
  // nach oben und lädt dadurch auch die verschachtelte; typescript-eslint
  // registriert deren Verzeichnis als zweite TSConfigRootDir-Kandidatin, was
  // `npm run lint` mit "multiple candidate TSConfigRootDirs" für *jede* Datei
  // scheitern lässt. Ohne das Ignore würde der Quelltext ohnehin doppelt geprüft.
  globalIgnores(['dist', '**/dist/**', '**/.claude/worktrees/**']),
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
      parserOptions: {
        // Explizit gesetzt, damit typescript-eslint die Wurzel nicht aus dem
        // Aufruf-Stack erraten muss — das schlägt fehl, sobald mehrere Kopien
        // des Repos sichtbar sind (Worktrees, gepackte Bundles).
        tsconfigRootDir: import.meta.dirname,
      },
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
