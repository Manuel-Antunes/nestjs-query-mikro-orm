/**
 * Measures the aggregation strategies against each other.
 *
 * Skipped unless `BENCH=1`, so it never slows the suite down: `pnpm bench`. It reports wall clock,
 * the
 * number of statements issued, and the number of rows those statements carried back, because the
 * last one is what actually separates the strategies: the in-memory reduction has to transport
 * every matching row, a grouped query transports one row per group.
 */
import { describe, it } from 'vitest';

import { MikroORM } from '@mikro-orm/core';
import type { EntityMetadata, EntityRepository } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { defineConfig as defineSqliteConfig, SqliteDriver } from '@mikro-orm/sqlite';

import type { AggregateStrategy } from '../../src';
import { InMemoryAggregateStrategy } from '../../src';
import { RelationQueryBuilder } from '../../src/lib/query';
import { SqlAggregateStrategy } from '../../src/sql';
import { RelationOfTestRelationEntity } from '../__fixtures__/relation-of-test-relation.entity';
import { TestEntityRelationEntity } from '../__fixtures__/test-entity-relation.entity';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestSoftDeleteEntity } from '../__fixtures__/test-soft-delete.entity';
import { TestEntity } from '../__fixtures__/test.entity';

const OWNERS = Number(process.env.OWNERS ?? 200);
const RELATIONS_PER_OWNER = Number(process.env.RELATIONS_PER_OWNER ?? 50);
const RUNS = Number(process.env.RUNS ?? 5);

interface Stats {
  statements: number;
  rows: number;
}

const stats: Stats = { statements: 0, rows: 0 };

const boot = async (): Promise<MikroORM> => {
  const orm = await MikroORM.init(
    defineSqliteConfig({
      driver: SqliteDriver,
      dbName: ':memory:',
      entities: [
        TestEntity,
        TestSoftDeleteEntity,
        TestRelation,
        TestEntityRelationEntity,
        RelationOfTestRelationEntity,
      ],
      allowGlobalContext: true,
      debug: ['query'],
      logger: (message: string) => {
        // the logger wraps statements in ANSI colour codes
        // eslint-disable-next-line no-control-regex
        const plain = message.replace(/\u001b\[\d+m/g, '');
        if (!/\bselect\b/i.test(plain)) return;
        stats.statements += 1;
        stats.rows += Number(/\[took [\d.]+ ms, (\d+) results?\]/.exec(plain)?.[1] ?? 0);
      },
    }),
  );
  await orm.schema.create();
  return orm;
};

const seedLarge = async (orm: MikroORM): Promise<void> => {
  const em = orm.em.fork();
  for (let i = 0; i < OWNERS; i++) {
    const entity = em.create(TestEntity, {
      testEntityPk: `owner-${i}`,
      stringType: `owner-${i}`,
      boolType: i % 2 === 0,
      numberType: i,
      dateType: new Date(2020, 0, 1 + (i % 28)),
    } as TestEntity);
    for (let r = 0; r < RELATIONS_PER_OWNER; r++) {
      em.create(TestRelation, {
        testRelationPk: `rel-${i}-${r}`,
        relationName: `rel-${i}-${r}`,
        testEntity: entity,
        testEntityId: entity.testEntityPk,
      } as unknown as TestRelation);
    }
  }
  await em.flush();
};

const time = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
  await fn(); // warm up
  stats.statements = 0;
  stats.rows = 0;
  const started = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) {
    await fn();
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6 / RUNS;
  console.log(
    `  ${label.padEnd(26)} ${ms.toFixed(1).padStart(8)} ms   ` +
      `${(stats.statements / RUNS).toFixed(0).padStart(4)} stmt   ` +
      `${(stats.rows / RUNS).toFixed(0).padStart(7)} rows transported`,
  );
};

const benchmark = async (): Promise<void> => {
  const orm = await boot();
  await seedLarge(orm);

  const meta = orm.em.getMetadata().get(TestEntity) as EntityMetadata<TestEntity>;
  const aggregate: AggregateQuery<TestEntity> = {
    count: [{ field: 'testEntityPk', args: {} }],
    sum: [{ field: 'numberType', args: {} }],
    max: [{ field: 'dateType', args: {} }],
  };

  const relationAggregate: AggregateQuery<TestRelation> = {
    count: [{ field: 'testRelationPk', args: {} }],
  };
  const owners = await orm.em.fork().find(TestEntity, {});

  const builderFor = (strategy: AggregateStrategy) =>
    new RelationQueryBuilder<TestEntity, TestRelation>(
      orm.em.fork().getRepository(TestEntity) as unknown as EntityRepository<TestEntity>,
      'testRelations',
      strategy,
    );

  const run = async (strategy: AggregateStrategy) => ({
    entity: () => strategy.execute<TestEntity>({ em: orm.em.fork(), meta, where: {}, aggregate }),
    relations: () => builderFor(strategy).batchAggregate(owners, {}, relationAggregate),
  });

  const inMemory = await run(new InMemoryAggregateStrategy());
  const sql = await run(new SqlAggregateStrategy());

  console.log(
    `\n${OWNERS} owners x ${RELATIONS_PER_OWNER} relations ` +
      `(${OWNERS * RELATIONS_PER_OWNER} relation rows), mean of ${RUNS} runs\n`,
  );

  console.log('grouped aggregate over the owners');
  await time('in-memory', inMemory.entity);
  await time('sql', sql.entity);

  console.log('\nbatched aggregate of every owner’s relations');
  await time('in-memory', inMemory.relations);
  await time('sql', sql.relations);

  await orm.close(true);
};

describe.skipIf(!process.env.BENCH)('aggregate strategy benchmark', () => {
  it('compares the strategies', benchmark, 600_000);
});
