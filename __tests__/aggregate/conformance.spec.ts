import type { EntityMetadata, MikroORM } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AggregateRecord, AggregateStrategy } from '../../src';
import { InMemoryAggregateStrategy, normalizeAggregateRecords } from '../../src';
import { MongoAggregateStrategy } from '../../src/mongo';
import { SqlAggregateStrategy } from '../../src/sql';
import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { seed, TEST_ENTITIES } from '../__fixtures__/seeds';
import { TestEntity } from '../__fixtures__/test.entity';

/**
 * The contract every aggregation strategy has to satisfy.
 *
 * Each backend answers in its own currency - SQLite reports a `MAX` over a datetime as epoch
 * milliseconds and a grouped boolean as 0/1, MongoDB reports the same two as a `Date` and a
 * `boolean` - so this suite runs the *same* assertions against every strategy to prove the
 * normalized output does not depend on which one is installed.
 *
 * A strategy for a backend this package does not ship (Neo4j, DynamoDB, ...) becomes conformant by
 * being added to `strategiesFor` and passing unchanged.
 */
const isMongo = () => (process.env.TEST_DRIVER ?? 'sqlite') === 'mongo';

const strategiesFor = (): [string, AggregateStrategy][] => [
  ['in-memory', new InMemoryAggregateStrategy()],
  isMongo() ? ['mongo', new MongoAggregateStrategy()] : ['sql', new SqlAggregateStrategy()],
];

describe('AggregateStrategy conformance', () => {
  let orm: MikroORM;

  beforeEach(async () => {
    orm = await createTestConnection();
    await seed(orm);
  });
  afterEach(closeTestConnection);

  const metaOf = (): EntityMetadata<TestEntity> => orm.em.getMetadata().get(TestEntity);

  /** Runs a strategy end to end, exactly the way the query service does. */
  const run = async (
    strategy: AggregateStrategy,
    aggregate: AggregateQuery<TestEntity>,
    where: object = {},
  ): Promise<AggregateRecord[]> => {
    const meta = metaOf();
    const records = await strategy.execute<TestEntity>({
      em: orm.em.fork(),
      meta,
      where,
      aggregate,
    });
    return normalizeAggregateRecords(records, meta);
  };

  /** Reads a value regardless of whether the backend nested its grouped columns under `_id`. */
  const read = (record: AggregateRecord, alias: string): unknown =>
    alias in record ? record[alias] : (record._id as AggregateRecord | null | undefined)?.[alias];

  describe.each(strategiesFor())('%s', (_name, strategy) => {
    it('counts only the rows where the column is set', async () => {
      const [record] = await run(strategy, { count: [{ field: 'testEntityPk', args: {} }] });
      expect(read(record, 'COUNT_testEntityPk')).toBe(TEST_ENTITIES.length);
    });

    it('sums and averages numeric columns', async () => {
      const [record] = await run(strategy, {
        sum: [{ field: 'numberType', args: {} }],
        avg: [{ field: 'numberType', args: {} }],
      });
      // the seed is 1..10
      expect(read(record, 'SUM_numberType')).toBe(55);
      expect(read(record, 'AVG_numberType')).toBe(5.5);
    });

    it('reports max and min of a numeric column as numbers', async () => {
      const [record] = await run(strategy, {
        max: [{ field: 'numberType', args: {} }],
        min: [{ field: 'numberType', args: {} }],
      });
      expect(read(record, 'MAX_numberType')).toBe(10);
      expect(read(record, 'MIN_numberType')).toBe(1);
    });

    it('reports max and min of a date column as Dates', async () => {
      const [record] = await run(strategy, {
        max: [{ field: 'dateType', args: {} }],
        min: [{ field: 'dateType', args: {} }],
      });
      const max = read(record, 'MAX_dateType');
      const min = read(record, 'MIN_dateType');
      expect(max).toBeInstanceOf(Date);
      expect(min).toBeInstanceOf(Date);
      expect((max as Date).getTime()).toBe(
        Math.max(...TEST_ENTITIES.map((e) => e.dateType.getTime())),
      );
      expect((min as Date).getTime()).toBe(
        Math.min(...TEST_ENTITIES.map((e) => e.dateType.getTime())),
      );
    });

    it('honours the filter', async () => {
      const [record] = await run(
        strategy,
        { count: [{ field: 'testEntityPk', args: {} }] },
        { numberType: { $lte: 3 } },
      );
      expect(read(record, 'COUNT_testEntityPk')).toBe(3);
    });

    it('groups by a boolean column and reports it as a boolean', async () => {
      const records = await run(strategy, {
        groupBy: [{ field: 'boolType', args: {} }],
        count: [{ field: 'testEntityPk', args: {} }],
      });
      expect(records).toHaveLength(2);

      const byGroup = new Map(
        records.map((r) => [read(r, 'GROUP_BY_boolType'), read(r, 'COUNT_testEntityPk')]),
      );
      expect([...byGroup.keys()].sort()).toEqual([false, true]);
      expect(byGroup.get(true)).toBe(5);
      expect(byGroup.get(false)).toBe(5);
    });

    it('groups and aggregates together', async () => {
      const records = await run(strategy, {
        groupBy: [{ field: 'boolType', args: {} }],
        sum: [{ field: 'numberType', args: {} }],
      });
      const byGroup = new Map(
        records.map((r) => [read(r, 'GROUP_BY_boolType'), read(r, 'SUM_numberType')]),
      );
      // odd numbers 1+3+5+7+9 = 25 for false, even 2+4+6+8+10 = 30 for true
      expect(byGroup.get(false)).toBe(25);
      expect(byGroup.get(true)).toBe(30);
    });

    it('supports additionalGroupBy on top of the requested grouping', async () => {
      const meta = metaOf();
      const records = normalizeAggregateRecords(
        await strategy.execute<TestEntity>({
          em: orm.em.fork(),
          meta,
          where: {},
          aggregate: { count: [{ field: 'testEntityPk', args: {} }] },
          additionalGroupBy: ['boolType'],
        }),
        meta,
      );
      expect(records).toHaveLength(2);
      records.forEach((record) => {
        expect(typeof read(record, 'GROUP_BY_boolType')).toBe('boolean');
        expect(read(record, 'COUNT_testEntityPk')).toBe(5);
      });
    });

    it('returns a single empty group when nothing was requested', async () => {
      const records = await run(strategy, {});
      // nothing to select: an empty record, or no records at all
      expect(records.every((r) => Object.keys(r).every((k) => k === '_id'))).toBe(true);
    });
  });
});

describe('InMemoryAggregateStrategy maxRows', () => {
  beforeEach(async () => {
    await createTestConnection();
    await seed();
  });
  afterEach(closeTestConnection);

  it('refuses to reduce more rows than it was allowed to hold', async () => {
    const orm = getTestConnection();
    const meta = orm.em.getMetadata().get(TestEntity);
    const strategy = new InMemoryAggregateStrategy({ maxRows: 3 });

    await expect(
      strategy.execute<TestEntity>({
        em: orm.em.fork(),
        meta,
        where: {},
        aggregate: { count: [{ field: 'testEntityPk', args: {} }] },
      }),
    ).rejects.toThrow(/refused to aggregate more than 3 rows/);
  });
});
