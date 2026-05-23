import { defineConfig } from 'vitest/config';

// Eigene, schlanke Test-Konfiguration (ohne PWA-/React-Plugins) — die Tests
// decken reine Logik (Provision, Datums-/Perioden-Mathematik, Validierung) ab.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
