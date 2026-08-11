import type { EntityName, EntityRepository } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RelationQueryBuilder } from '../../src/lib/query';
import { IS_MONGO } from '../__fixtures__/driver';
import { CustomHydrator } from '../__fixtures__/not-managed/connection.fixture';
import { RelationOfTestRelationSchema } from '../__fixtures__/not-managed/relation-of-test-relation.entity';
import { seed, TEST_ENTITIES, TEST_RELATIONS } from '../__fixtures__/not-managed/seeds';
import { TestEntityRelationSchema } from '../__fixtures__/not-managed/test-entity-relation.entity';
import type { TestRelation } from '../__fixtures__/not-managed/test-relation.entity';
import { TestRelationSchema } from '../__fixtures__/not-managed/test-relation.entity';
import { TestSoftDeleteSchema } from '../__fixtures__/not-managed/test-soft-delete.entity';
import type { TestEntity } from '../__fixtures__/not-managed/test.entity';
import { TestSchema } from '../__fixtures__/not-managed/test.entity';

/**
 * Entities that keep their own state (and therefore never let the ORM hydrate a relation onto
 * them) still have to be batched, so these specs assert the query count for that style too.
 */
describe.skipIf(IS_MONGO)('RelationQueryBuilder batching (not managed)', (): void => {
  let orm: MikroORM;
  let queries: string[] = [];

  beforeEach(async () => {
    queries = [];
    orm = await MikroORM.init({
      hydrator: CustomHydrator,
      driver: SqliteDriver,
      dbName: ':memory:',
      propagationOnPrototype: false,
      entities: [
        TestSchema,
        TestSoftDeleteSchema,
        TestRelationSchema,
        TestEntityRelationSchema,
        RelationOfTestRelationSchema,
      ],
      allowGlobalContext: true,
      debug: ['query'],
      logger: (message: string) => queries.push(message),
    } as never);
    await orm.schema.create();
    await seed(orm);
  });

  afterEach(async () => {
    await orm.close(true);
  });

  const builderFor = <Entity extends object, Relation extends object>(
    entityName: string,
    relationName: string,
  ): RelationQueryBuilder<Entity, Relation> => {
    queries = [];
    return new RelationQueryBuilder(
      // the not-managed suite registers its entities by name, which `EntityName` no longer admits
      orm.em
        .fork()
        .getRepository(
          entityName as unknown as EntityName<Entity>,
        ) as unknown as EntityRepository<Entity>,
      relationName,
    );
  };

  /** Only the selects matter, MikroORM also logs transaction statements. */
  const selects = (): string[] => queries.filter((q) => q.includes('select'));
  const selectCount = (): number => selects().length;

  it('batches a oneToMany into a single query', async () => {
    const dtos = TEST_ENTITIES.slice(0, 5) as TestEntity[];
    const result = await builderFor<TestEntity, TestRelation>(
      'TestEntity',
      'testRelations',
    ).batchSelectAndExecute(dtos, {});

    expect(selectCount()).toBe(1);
    expect(result.size).toBe(5);
    dtos.forEach((dto) => {
      expect(result.get(dto)?.map((r) => r.id)).toEqual(
        TEST_RELATIONS.filter((r) => r.testEntityId === dto.id).map((r) => r.id),
      );
    });
  });

  it('batches a manyToOne into a single query', async () => {
    const dtos = TEST_RELATIONS.slice(0, 6) as TestRelation[];
    const result = await builderFor<TestRelation, TestEntity>(
      'TestRelation',
      'testEntity',
    ).batchSelectAndExecute(dtos, {});

    expect(selectCount()).toBe(1);
    dtos.forEach((dto) => {
      expect(result.get(dto)?.map((e) => e.id)).toEqual([dto.testEntityId]);
    });
  });

  it('batches a oneToOne into a single query', async () => {
    const dtos = TEST_ENTITIES.slice(0, 5) as TestEntity[];
    const result = await builderFor<TestEntity, TestRelation>(
      'TestEntity',
      'oneTestRelation',
    ).batchSelectAndExecute(dtos, {});

    expect(selectCount()).toBe(1);
    dtos.forEach((dto) => {
      expect(result.get(dto)?.map((r) => r.id)).toEqual([`test-relations-${dto.id}-1`]);
    });
  });

  it('counts without loading the relations', async () => {
    const dtos = TEST_ENTITIES.slice(0, 5) as TestEntity[];
    const result = await builderFor<TestEntity, TestRelation>(
      'TestEntity',
      'testRelations',
    ).batchCount(dtos, {});

    expect(selects().length).toBeGreaterThan(0);
    selects().forEach((query) => expect(query).toContain('count('));
    dtos.forEach((dto) => expect(result.get(dto)).toBe(3));
  });
});
