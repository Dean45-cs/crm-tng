import { defineConfig } from 'vitest/config';

// Eigene, schlanke Test-Konfiguration — lädt bewusst nicht die App-Vite-Config
// (PWA-Plugin etc.), die Tests sind reine Logik-Tests im Node-Environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
