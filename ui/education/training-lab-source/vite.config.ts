/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [
        react(),
        {
            name: 'pilotdeck-local-models',
            enforce: 'pre',
            transform(code, id) {
                if (id.includes('@genai-fi/classifier/') && id.endsWith('.js')) {
                    return code.replace(/(["'])(https:\/\/(?:store\.gen-ai\.fi\/tm\/|tmstore\.blob\.core\.windows\.net\/))([^"']+)\1/g,
                        (_match, _quote, _origin, asset) => `new URL(${JSON.stringify('/' + asset)}, window.location.origin).href`);
                }
                if (id.includes('@genai-fi/base/') && id.endsWith('.css')) {
                    return code.replace(/@font-face\{[^}]+\}/g, '');
                }
                return null;
            },
        },
    ],
    build: {
        outDir: '../training-lab',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                inlineDynamicImports: mode === 'robot',
            },
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: './src/setupTests.ts',
        clearMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['cobertura', 'html'],
        },
        server: {
            deps: {
                inline: ['@genai-fi/base'],
            },
        },
    },
    resolve: {
        alias: {
            '@genaitm': path.resolve(import.meta.dirname, './src'),
        },
    },
}));
