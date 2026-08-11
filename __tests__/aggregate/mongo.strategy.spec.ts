import type { EntityManager, EntityMetadata, MikroORM } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { defineConfig as defineMongoConfig, MikroORM as MongoMikroORM } from '@mikro-orm/mongodb';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AggregateRecord } from '../../src';
import { normalizeAggregateRecords } from '../../src';
import { MongoAggregateStrategy } from '../../src/mongo';

/**
 * Covers `MongoAggregateStrategy` regardless of which driver the rest of the suite runs against.
 *
 * The shared fixtures map their primary key through `pkName()`, which only becomes `_id` when the
 * whole suite is running as `TEST_DRIVER=mongo`, so this spec brings its own entity. Column names
 * deliberately differ from the property names - that is what exercises the property-to-column
 * translation on both the `$group` and the `$match` side.
 */
@Entity({ collection: 'mongo_agg_entity' })
class MongoAggEntity {
  @PrimaryKey({ name: '_id', type: 'string' })
  id!: string;

  @Property({ name: 'string_type', type: 'string' })
  stringType!: string;

  @Property({ name: 'bool_type', type: 'boolean' })
  boolType!: boolean;

  @Property({ name: 'number_type', type: 'number' })
  numberType!: number;

  @Property({ name: 'date_type', type: 'Date' })
  dateType!: Date;

  @Property({ name: 'nullable_type', type: 'number', nullable: true })
  nullableType?: number;
}

const SEED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('MongoAggregateStrategy', () => {
  let mongod: MongoMemoryServer;
  let orm: MikroORM;
  let strategy: MongoAggregateStrategy;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    orm = await MongoMikroORM.init(
      defineMongoConfig({
        clientUrl: mongod.getUri(),
        dbName: 'aggregate-strategy',
        entities: [MongoAggEntity],
        allowGlobalContext: true,
        debug: false,
      }),
    );

    const em = orm.em.fork();
    SEED.forEach((i) =>
      em.create(MongoAggEntity, {
        id: `row-${i}`,
        stringType: `foo${i}`,
        boolType: i % 2 === 0,
        numberType: i,
        dateType: new Date(`2020-02-${String(i).padStart(2, '0')}T00:00:00.000Z`),
        // only the even rows carry a value, so COUNT has something to skip
        nullableType: i % 2 === 0 ? i : undefined,
      } as MongoAggEntity),
    );
    await em.flush();

    strategy = new MongoAggregateStrategy();
  }, 120_000);

  afterAll(async () => {
    await orm?.close(true);
    await mongod?.stop();
  });

  const meta = (): EntityMetadata<MongoAggEntity> => orm.em.getMetadata().get(MongoAggEntity);

  const run = async (
    aggregate: AggregateQuery<MongoAggEntity>,
    where: object = {},
    additionalGroupBy?: string[],
  ): Promise<AggregateRecord[]> =>
    normalizeAggregateRecords(
      await strategy.execute<MongoAggEntity>({
        em: orm.em.fork(),
        meta: meta(),
        where,
        aggregate,
        additionalGroupBy,
      }),
      meta(),
    );

  const read = (record: AggregateRecord, alias: string): unknown =>
    alias in record ? record[alias] : (record._id as AggregateRecord | null | undefined)?.[alias];

  it('computes every function in one ungrouped record', async () => {
    const [record] = await run({
      count: [{ field: 'id', args: {} }],
      sum: [{ field: 'numberType', args: {} }],
      avg: [{ field: 'numberType', args: {} }],
      max: [{ field: 'numberType', args: {} }],
      min: [{ field: 'numberType', args: {} }],
    });

    expect(read(record, 'COUNT_id')).toBe(10);
    expect(read(record, 'SUM_numberType')).toBe(55);
    expect(read(record, 'AVG_numberType')).toBe(5.5);
    expect(read(record, 'MAX_numberType')).toBe(10);
    expect(read(record, 'MIN_numberType')).toBe(1);
  });

  it('skips documents where the counted field is missing, like SQL COUNT(column)', async () => {
    const [record] = await run({ count: [{ field: 'nullableType', args: {} }] });
    // only the five even rows carry `nullableType`
    expect(read(record, 'COUNT_nullableType')).toBe(5);
  });

  it('translates the filter from property names to stored field names', async () => {
    // `numberType` lives in the `number_type` field; a raw pipeline would match nothing
    const [record] = await run({ count: [{ field: 'id', args: {} }] }, { numberType: { $lte: 3 } });
    expect(read(record, 'COUNT_id')).toBe(3);
  });

  it('resolves the primary key alias in the filter', async () => {
    // `id` is stored as `_id`, which is what `renameFields` is there to handle
    const [record] = await run({ count: [{ field: 'id', args: {} }] }, { id: 'row-1' });
    expect(read(record, 'COUNT_id')).toBe(1);
  });

  it('groups by a column and reports the grouped value', async () => {
    const records = await run({
      groupBy: [{ field: 'boolType', args: {} }],
      count: [{ field: 'id', args: {} }],
    });

    expect(records).toHaveLength(2);
    const byGroup = new Map(
      records.map((r) => [read(r, 'GROUP_BY_boolType'), read(r, 'COUNT_id')]),
    );
    expect(byGroup.get(true)).toBe(5);
    expect(byGroup.get(false)).toBe(5);
  });

  it('groups by several columns at once', async () => {
    const records = await run({
      groupBy: [
        { field: 'boolType', args: {} },
        { field: 'stringType', args: {} },
      ],
      count: [{ field: 'id', args: {} }],
    });

    // every row has its own stringType, so each is its own group
    expect(records).toHaveLength(10);
    records.forEach((record) => {
      expect(typeof read(record, 'GROUP_BY_boolType')).toBe('boolean');
      expect(read(record, 'COUNT_id')).toBe(1);
    });
  });

  it('adds additionalGroupBy to the grouping', async () => {
    const records = await run({ count: [{ field: 'id', args: {} }] }, {}, ['boolType']);

    expect(records).toHaveLength(2);
    records.forEach((record) => expect(read(record, 'COUNT_id')).toBe(5));
  });

  it('reports a max over a date column, which normalizes back to a Date', async () => {
    const [record] = await run({ max: [{ field: 'dateType', args: {} }] });
    const max = read(record, 'MAX_dateType');

    expect(max).toBeInstanceOf(Date);
    expect((max as Date).toISOString()).toBe('2020-02-10T00:00:00.000Z');
  });

  it('returns no records when nothing was requested', async () => {
    expect(await run({})).toEqual([]);
  });

  it('refuses an EntityManager that cannot aggregate', async () => {
    const notMongo = { getDriver: () => ({}) } as unknown as EntityManager;

    await expect(
      strategy.execute<MongoAggEntity>({
        em: notMongo,
        meta: meta(),
        where: {},
        aggregate: { count: [{ field: 'id', args: {} }] },
      }),
    ).rejects.toThrow(/requires the MongoDB EntityManager/);
  });

  it('passes the filter through untouched when the driver cannot rename fields', async () => {
    const em = orm.em.fork();
    const calls: unknown[][] = [];
    const driverless = {
      getDriver: () => ({}),
      aggregate: (entityName: unknown, pipeline: unknown[]) => {
        calls.push([entityName, pipeline]);
        return Promise.resolve([]);
      },
    } as unknown as EntityManager;

    await strategy.execute<MongoAggEntity>({
      em: driverless,
      meta: meta(),
      // already a stored field name, which is what an unrenamed filter would look like
      where: { number_type: 1 } as unknown as Record<string, unknown>,
      aggregate: { count: [{ field: 'id', args: {} }] },
    });

    const [[, pipeline]] = calls as [[unknown, { $match: unknown }[]]];
    expect(pipeline[0].$match).toEqual({ number_type: 1 });
    await em.getConnection().close();
  });
});
