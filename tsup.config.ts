import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
  },
  tsconfig: './tsconfig.build.json',
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  outExtension: ({ format }) => ({
    js: format === 'esm' ? '.mjs' : '.cjs',
  }),
  external: [
    '@mikro-orm/core',
    '@mikro-orm/knex',
    '@mikro-orm/nestjs',
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs-query/core',
    'camel-case',
    'class-transformer',
    'lodash.filter',
    'lodash.merge',
    'lodash.omit',
    'reflect-metadata',
    'rxjs',
    'uuid',
  ],
});
