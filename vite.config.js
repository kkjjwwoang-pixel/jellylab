import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /three\.core\.js/, priority: 20 },
            { name: 'three-webgpu', test: /node_modules[\\/]three/, priority: 10 },
          ],
        },
      },
    },
  },
});
