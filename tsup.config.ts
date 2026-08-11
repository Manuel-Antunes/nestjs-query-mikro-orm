import { defineConfig } from 'tsup';

export default defineConfig({
  // one entry per subpath export: the database-side strategies must not be pulled in by the
  // main bundle, so that applications only resolve the driver package they actually use
  entry: ['src/index.ts', 'src/sql.ts', 'src/mongo.ts', 'src/neo4j.ts'],
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
    '@mikro-orm/mongodb',
    '@mikro-orm/nestjs',
    '@mikro-orm/sql',
    'mikro-orm-neo4j',
    '@nestjs/common',
    '@nestjs/core',
    '@ptc-org/nestjs-query-core',
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
