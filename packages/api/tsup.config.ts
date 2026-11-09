import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'reset-demo': 'src/jobs/resetDemo.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace domain package (it ships TypeScript sources).
  noExternal: ['@prms/domain'],
});
