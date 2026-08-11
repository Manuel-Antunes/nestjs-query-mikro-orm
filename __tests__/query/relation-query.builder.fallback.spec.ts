import type { EntityRepository, MikroORM } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AggregateRecord } from '../../src';
import { InMemoryAggregateStrategy, normalizeAggregateRecords } from '../../src';
import { RelationQueryBuilder } from '../../src/lib/query';
import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { seed, TEST_ENTITIES } from '../__fixtures__/seeds';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestEntity } from '../__fixtures__/test.entity';

/**
 * The batched aggregate only pushes a `GROUP BY` down when the relation rows carry the owning key
 * themselves. Everything else has to fall back to loading the rows and reducing them, and has to
 * produce the same answer - these specs cover the paths the conformance suites never reach because
 * they all use a plain one-to-many.
 */
describe('RelationQueryBuilder aggregate fallbacks', () => {
  let orm: MikroORM;

  beforeEach(async () => {
    orm = await createTestConnection();
    await seed(orm);
  });
  afterEach(closeTestConnection);

  const builderFor = <Relation extends object>(relationName: string) =>
    new RelationQueryBuilder<TestEntity, Relation>(
      orm.em.fork().getRepository(TestEntity) as unknown as EntityRepository<TestEntity>,
      relationName,
      new InMemoryAggregateStrategy(),
    );

  const countOf = (records: AggregateRecord[], field: string) =>
    normalizeAggregateRecords(records, orm.em.getMetadata().get(TestRelation))[0]?.[
      `COUNT_${field}`
    ];

  it('returns an empty map for no entities at all', async () => {
    const result = await builderFor<TestRelation>('testRelations').batchAggregate([], {}, {
      count: [{ field: 'testRelationPk', args: {} }],
    } as AggregateQuery<TestRelation>);

    expect(result.size).toBe(0);
  });

  it('falls back to loading the rows for a many-to-many relation', async () => {
    // `manyTestRelations` keeps its keys in a pivot table, so there is no owner column to group by
    const entities = TEST_ENTITIES.filter((e) => e.numberType % 2 === 0).slice(0, 2);
    const result = await builderFor<TestRelation>('manyTestRelations').batchAggregate(
      entities,
      {},
      { count: [{ field: 'testRelationPk', args: {} }] } as AggregateQuery<TestRelation>,
    );

    expect(result.size).toBe(2);
    entities.forEach((entity) => {
      // the even entities were given every relation whose name ends in `two`
      expect(countOf(result.get(entity) ?? [], 'testRelationPk')).toBe(TEST_ENTITIES.length);
    });
  });

  it('falls back when an entity carries no primary key to group by', async () => {
    const keyless = { stringType: 'no key at all' } as TestEntity;
    const result = await builderFor<TestRelation>('testRelations').batchAggregate([keyless], {}, {
      count: [{ field: 'testRelationPk', args: {} }],
    } as AggregateQuery<TestRelation>);

    // it still has to answer, over an empty set
    expect(countOf(result.get(keyless) ?? [], 'testRelationPk')).toBe(0);
  });

  it('aggregates a many-to-one relation, which is keyed on the entity side', async () => {
    const relations = await orm.em.fork().find(TestRelation, {}, { limit: 3 });
    const builder = new RelationQueryBuilder<TestRelation, TestEntity>(
      orm.em.fork().getRepository(TestRelation) as unknown as EntityRepository<TestRelation>,
      'testEntity',
      new InMemoryAggregateStrategy(),
    );

    const result = await builder.batchAggregate(relations, {}, {
      count: [{ field: 'testEntityPk', args: {} }],
    } as AggregateQuery<TestEntity>);

    expect(result.size).toBe(relations.length);
    relations.forEach((relation) => {
      const [record] = result.get(relation) ?? [];
      // each relation points at exactly one entity
      expect(record.COUNT_testEntityPk).toBe(1);
    });
  });

  it('aggregates a one-to-one relation the owner side holds the key for', async () => {
    // loaded rather than seeded: the owning side only carries the foreign key once hydrated, and
    // how a bare dto resolves it differs between drivers
    const entities = await orm.em.fork().find(TestEntity, {}, { limit: 2 });
    const result = await builderFor<TestRelation>('oneTestRelation').batchAggregate(entities, {}, {
      count: [{ field: 'testRelationPk', args: {} }],
    } as AggregateQuery<TestRelation>);

    expect(result.size).toBe(2);
    entities.forEach((entity) => {
      expect(countOf(result.get(entity) ?? [], 'testRelationPk')).toBe(1);
    });
  });
});
