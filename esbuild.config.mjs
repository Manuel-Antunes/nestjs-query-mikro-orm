import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

// Common configuration
const commonConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
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
  sourcemap: true,
  minify: false,
  metafile: true,
  logLevel: 'info',
};

// ESM build
const esmConfig = {
  ...commonConfig,
  format: 'esm',
  outfile: 'dist/index.js',
};

// CJS build
const cjsConfig = {
  ...commonConfig,
  format: 'cjs',
  outfile: 'dist/index.cjs',
};

async function build() {
  console.log('🏗️  Building ESM version...');
  const esmCtx = await esbuild.context(esmConfig);
  await esmCtx.rebuild();

  console.log('🏗️  Building CJS version...');
  const cjsCtx = await esbuild.context(cjsConfig);
  await cjsCtx.rebuild();

  await esmCtx.dispose();
  await cjsCtx.dispose();

  console.log('✅ Build complete!');
}

async function watch() {
  console.log('👀 Watching for changes...');

  const esmCtx = await esbuild.context(esmConfig);
  const cjsCtx = await esbuild.context(cjsConfig);

  await Promise.all([
    esmCtx.watch(),
    cjsCtx.watch(),
  ]);
}

if (isWatch) {
  await watch();
} else {
  await build();
}
