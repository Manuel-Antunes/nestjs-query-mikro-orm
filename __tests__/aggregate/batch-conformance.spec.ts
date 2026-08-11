import type { EntityRepository, MikroORM } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AggregateRecord, AggregateStrategy } from '../../src';
import { InMemoryAggregateStrategy, normalizeAggregateRecords } from '../../src';
import { RelationQueryBuilder } from '../../src/lib/query';
import { MongoAggregateStrategy } from '../../src/mongo';
import { SqlAggregateStrategy } from '../../src/sql';
import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { IS_MONGO } from '../__fixtures__/driver';
import { seed, TEST_ENTITIES } from '../__fixtures__/seeds';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestEntity } from '../__fixtures__/test.entity';

/**
 * Batched relation aggregates have to answer the same thing whichever strategy is installed.
 *
 * The single-entity contract is covered by `conformance.spec.ts`; this covers the batched path,
 * where the owning key joins the grouping so every owner can be answered in one round trip - and
 * must not leak into the response as a grouped field.
 */
const strategies = (): [string, AggregateStrategy][] => [
  ['in-memory', new InMemoryAggregateStrategy()],
  IS_MONGO ? ['mongo', new MongoAggregateStrategy()] : ['sql', new SqlAggregateStrategy()],
];

describe('batched relation aggregate conformance', () => {
  let orm: MikroORM;

  beforeEach(async () => {
    orm = await createTestConnection();
    await seed(orm);
  });
  afterEach(closeTestConnection);

  const builderFor = (strategy: AggregateStrategy) =>
    new RelationQueryBuilder<TestEntity, TestRelation>(
      orm.em.fork().getRepository(TestEntity) as unknown as EntityRepository<TestEntity>,
      'testRelations',
      strategy,
    );

  const normalize = (records: AggregateRecord[]) =>
    normalizeAggregateRecords(records, orm.em.getMetadata().get(TestRelation));

  const AGGREGATE: AggregateQuery<TestRelation> = {
    count: [{ field: 'testRelationPk', args: {} }],
    max: [{ field: 'relationName', args: {} }],
  };

  const read = (record: AggregateRecord, alias: string): unknown =>
    alias in record ? record[alias] : (record._id as AggregateRecord | null | undefined)?.[alias];

  describe.each(strategies())('%s', (_name, strategy) => {
    it('answers every owner with the aggregate over its own relations', async () => {
      const entities = TEST_ENTITIES.slice(0, 3);
      const result = await builderFor(strategy).batchAggregate(entities, {}, AGGREGATE);

      expect(result.size).toBe(3);
      entities.forEach((entity) => {
        const [record] = result.get(entity) ?? [];
        expect(normalize([record])[0].COUNT_testRelationPk).toBe(3);
      });
    });

    it('does not leak the owning key into the response', async () => {
      const [entity] = TEST_ENTITIES;
      const result = await builderFor(strategy).batchAggregate([entity], {}, AGGREGATE);
      const [record] = result.get(entity) ?? [];

      // the owner column is a grouping detail of the batch, not something the caller asked for
      expect(read(record, 'GROUP_BY_testEntity')).toBeUndefined();
      expect(Object.keys(record).filter((k) => k.startsWith('GROUP_BY_'))).toEqual([]);
    });

    it('answers owners that have no relations at all', async () => {
      const orphan = { ...TEST_ENTITIES[0], testEntityPk: 'no-relations-at-all' } as TestEntity;
      const result = await builderFor(strategy).batchAggregate([orphan], {}, AGGREGATE);

      const [record] = result.get(orphan) ?? [];
      expect(normalize([record])[0].COUNT_testRelationPk).toBe(0);
    });

    it('honours the relation filter', async () => {
      const entities = TEST_ENTITIES.slice(0, 2);
      // `in` rather than `like`: MongoDB has no `$like`, and the point here is the batching
      const result = await builderFor(strategy).batchAggregate(
        entities,
        {
          filter: {
            relationName: {
              in: entities.map((e) => `${e.stringType}-test-relation-one`),
            },
          },
        },
        AGGREGATE,
      );

      entities.forEach((entity) => {
        const [record] = result.get(entity) ?? [];
        expect(normalize([record])[0].COUNT_testRelationPk).toBe(1);
      });
    });

    it('keeps a requested groupBy alongside the batching', async () => {
      const entities = TEST_ENTITIES.slice(0, 2);
      const result = await builderFor(strategy).batchAggregate(entities, {}, {
        ...AGGREGATE,
        groupBy: [{ field: 'relationName', args: {} }],
      } as AggregateQuery<TestRelation>);

      entities.forEach((entity) => {
        const records = normalize(result.get(entity) ?? []);
        // three relations per entity, each with its own name
        expect(records).toHaveLength(3);
        records.forEach((record) => {
          expect(read(record, 'GROUP_BY_relationName')).toEqual(expect.any(String));
          expect(read(record, 'COUNT_testRelationPk')).toBe(1);
        });
      });
    });
  });
});

/**
 * The reason the batched path exists: the whole point of pushing a grouped aggregate down is that
 * the number of round trips stops depending on how many owners were asked about.
 */
describe.skipIf(IS_MONGO)('batched relation aggregate query count', () => {
  let orm: MikroORM;
  let queries: string[] = [];

  beforeEach(async () => {
    orm = await createTestConnection({ logger: (message: string) => queries.push(message) });
    await seed(orm);
    queries = [];
  });
  afterEach(closeTestConnection);

  // the logger wraps statements in ANSI colour codes, so they are stripped before matching
  // eslint-disable-next-line no-control-regex
  const plain = (q: string) => q.replace(/\u001b\[\d+m/g, '');
  const selects = () => queries.map(plain).filter((q) => /\bselect\b/i.test(q));

  const builderFor = (strategy: AggregateStrategy) =>
    new RelationQueryBuilder<TestEntity, TestRelation>(
      orm.em.fork().getRepository(TestEntity) as unknown as EntityRepository<TestEntity>,
      'testRelations',
      strategy,
    );

  const AGG: AggregateQuery<TestRelation> = { count: [{ field: 'testRelationPk', args: {} }] };

  it('groups every owner into a single statement with the sql strategy', async () => {
    queries = [];
    await builderFor(new SqlAggregateStrategy()).batchAggregate(TEST_ENTITIES, {}, AGG);

    expect(selects()).toHaveLength(1);
    expect(selects()[0]).toMatch(/group by/i);
  });

  it('still issues a single statement with the in-memory strategy, but selects the rows', async () => {
    queries = [];
    await builderFor(new InMemoryAggregateStrategy()).batchAggregate(TEST_ENTITIES, {}, AGG);

    // one query either way - the difference is that this one carries every relation row back
    expect(selects()).toHaveLength(1);
    expect(selects()[0]).not.toMatch(/group by/i);
  });
});
