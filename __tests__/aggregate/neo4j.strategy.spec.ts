import type { EntityMetadata } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { defineConfig, MikroORM, type Neo4jEntityManager } from 'mikro-orm-neo4j';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AggregateRecord } from '../../src';
import { normalizeAggregateRecords } from '../../src';
import { Neo4jAggregateStrategy } from '../../src/neo4j';
import type { StartedNeo4jContainer } from '../utils/setup-neo4j-container';
import { setupNeo4jContainer } from '../utils/setup-neo4j-container';

/**
 * Covers `Neo4jAggregateStrategy` against a real Neo4j, started as a test container.
 *
 * Set `NEO4J_URL` to point at an instance you already have running and the container is skipped -
 * useful while iterating, since starting one costs the better part of a minute.
 *
 * The Cypher this builds is asserted separately in `neo4j.cypher.spec.ts`, which needs neither a
 * server nor Docker.
 */
const EXISTING_URL = process.env.NEO4J_URL;

const AUTH = { username: 'neo4j', password: 'testtest' };

@Entity()
class Neo4jAggEntity {
  @PrimaryKey({ name: 'id', type: 'string' })
  id!: string;

  @Property({ name: 'string_type', type: 'string' })
  stringType!: string;

  @Property({ name: 'bool_type', type: 'boolean' })
  boolType!: boolean;

  @Property({ name: 'number_type', type: 'number' })
  numberType!: number;

  @Property({ name: 'nullable_type', type: 'number', nullable: true })
  nullableType?: number;
}

const SEED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('Neo4jAggregateStrategy', () => {
  let orm: Awaited<ReturnType<typeof MikroORM.init>>;
  let started: StartedNeo4jContainer | undefined;
  const strategy = new Neo4jAggregateStrategy();

  beforeAll(async () => {
    if (!EXISTING_URL) {
      started = await setupNeo4jContainer(AUTH);
    }

    orm = await MikroORM.init(
      defineConfig({
        // the driver reads the database off the pathname, which the container URI has no room for
        clientUrl: `${EXISTING_URL ?? started!.connectionUri}/neo4j`,
        dbName: 'neo4j',
        user: AUTH.username,
        password: AUTH.password,
        ensureDatabase: false,
        entities: [Neo4jAggEntity],
        allowGlobalContext: true,
        debug: false,
      } as never),
    );

    const em = orm.em.fork() as Neo4jEntityManager;
    await em.run('MATCH (n) DETACH DELETE n');
    SEED.forEach((i) =>
      em.create(Neo4jAggEntity, {
        id: `row-${i}`,
        stringType: `foo${i}`,
        boolType: i % 2 === 0,
        numberType: i,
        // only the even rows carry a value, so count has something to skip
        nullableType: i % 2 === 0 ? i : undefined,
      } as Neo4jAggEntity),
    );
    await em.flush();
  }, 500_000);

  afterAll(async () => {
    await orm?.close(true);
    await started?.container.stop();
    await started?.network.stop();
  });

  const meta = (): EntityMetadata<Neo4jAggEntity> => orm.em.getMetadata().get(Neo4jAggEntity);

  const run = async (
    aggregate: AggregateQuery<Neo4jAggEntity>,
    where: object = {},
    additionalGroupBy?: string[],
  ): Promise<AggregateRecord[]> =>
    normalizeAggregateRecords(
      await strategy.execute<Neo4jAggEntity>({
        em: orm.em.fork(),
        meta: meta(),
        where,
        aggregate,
        additionalGroupBy,
      }),
      meta(),
    );

  it('computes every function in one ungrouped record', async () => {
    const [record] = await run({
      count: [{ field: 'id', args: {} }],
      sum: [{ field: 'numberType', args: {} }],
      avg: [{ field: 'numberType', args: {} }],
      max: [{ field: 'numberType', args: {} }],
      min: [{ field: 'numberType', args: {} }],
    });

    expect(record.COUNT_id).toBe(10);
    expect(record.SUM_numberType).toBe(55);
    expect(record.AVG_numberType).toBe(5.5);
    expect(record.MAX_numberType).toBe(10);
    expect(record.MIN_numberType).toBe(1);
  });

  it('skips nodes where the counted property is missing', async () => {
    const [record] = await run({ count: [{ field: 'nullableType', args: {} }] });
    expect(record.COUNT_nullableType).toBe(5);
  });

  it('groups by a property and reports it as a boolean', async () => {
    const records = await run({
      groupBy: [{ field: 'boolType', args: {} }],
      count: [{ field: 'id', args: {} }],
    });

    expect(records).toHaveLength(2);
    const byGroup = new Map(records.map((r) => [r.GROUP_BY_boolType, r.COUNT_id]));
    expect(byGroup.get(true)).toBe(5);
    expect(byGroup.get(false)).toBe(5);
  });

  it('adds additionalGroupBy to the grouping', async () => {
    const records = await run({ count: [{ field: 'id', args: {} }] }, {}, ['boolType']);
    expect(records).toHaveLength(2);
    records.forEach((record) => expect(record.COUNT_id).toBe(5));
  });

  it.each([
    ['eq', { stringType: { $eq: 'foo1' } }, 1],
    ['ne', { stringType: { $ne: 'foo1' } }, 9],
    ['gt', { numberType: { $gt: 7 } }, 3],
    ['gte', { numberType: { $gte: 7 } }, 4],
    ['lt', { numberType: { $lt: 3 } }, 2],
    ['lte', { numberType: { $lte: 3 } }, 3],
    ['in', { numberType: { $in: [1, 2, 3] } }, 3],
    ['nin', { numberType: { $nin: [1, 2, 3] } }, 7],
    ['like', { stringType: { $like: 'foo1%' } }, 2],
    ['ilike', { stringType: { $ilike: 'FOO1%' } }, 2],
    ['not like', { stringType: { $not: { $like: 'foo1%' } } }, 8],
    ['is null', { nullableType: { $eq: null } }, 5],
    ['is not null', { nullableType: { $ne: null } }, 5],
    ['shorthand equality', { stringType: 'foo1' }, 1],
    ['and', { $and: [{ numberType: { $gte: 3 } }, { numberType: { $lte: 5 } }] }, 3],
    ['or', { $or: [{ numberType: { $eq: 1 } }, { numberType: { $eq: 2 } }] }, 2],
    ['several operators on one property', { numberType: { $gte: 3, $lte: 5 } }, 3],
  ])('honours a %s filter', async (_name, where, expected) => {
    const [record] = await run({ count: [{ field: 'id', args: {} }] }, where);
    expect(record.COUNT_id).toBe(expected);
  });

  it('returns no records when nothing was requested', async () => {
    expect(await run({})).toEqual([]);
  });
});
