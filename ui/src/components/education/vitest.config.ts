import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The UI owns Vitest in pnpm's isolated layout; retain the root test setup.
const uiDependency = (name: string) =>
  fileURLToPath(new URL(`../../../node_modules/${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      react: uiDependency('react'),
      'react-dom': uiDependency('react-dom'),
      'react/jsx-dev-runtime': uiDependency('react/jsx-dev-runtime.js'),
      'react/jsx-runtime': uiDependency('react/jsx-runtime.js'),
      'react-i18next': uiDependency('react-i18next'),
      'lucide-react': uiDependency('lucide-react'),
    },
  },
  test: {
    setupFiles: [fileURLToPath(new URL('../../../../vitest.setup.ts', import.meta.url))],
    environmentOptions: { jsdom: { url: 'http://localhost:3001/' } },
  },
});
