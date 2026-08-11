import type { EntityRepository } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import type { Class } from '@ptc-org/nestjs-query-core';
import { SortDirection } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RelationQueryBuilder } from '../../src/lib/query';
import { IS_MONGO } from '../__fixtures__/driver';
import { RelationOfTestRelationEntity } from '../__fixtures__/relation-of-test-relation.entity';
import { seed, TEST_ENTITIES, TEST_RELATIONS } from '../__fixtures__/seeds';
import { TestEntityRelationEntity } from '../__fixtures__/test-entity-relation.entity';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestSoftDeleteEntity } from '../__fixtures__/test-soft-delete.entity';
import { TestEntity } from '../__fixtures__/test.entity';

/**
 * The batched relation loading must not degrade into one query per entity, so these specs assert
 * the emitted query count on top of the mapping itself.
 */
describe.skipIf(IS_MONGO)('RelationQueryBuilder batching', (): void => {
  let orm: MikroORM;
  let queries: string[] = [];

  beforeEach(async () => {
    queries = [];
    orm = await MikroORM.init({
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
      logger: (message: string) => queries.push(message),
    } as never);
    await orm.schema.create();
    await seed(orm);
  });

  afterEach(async () => {
    await orm.close(true);
  });

  const builderFor = <Entity extends object, Relation extends object>(
    EntityClass: Class<Entity>,
    relationName: string,
  ): RelationQueryBuilder<Entity, Relation> => {
    queries = [];
    return new RelationQueryBuilder(
      orm.em.fork().getRepository(EntityClass) as unknown as EntityRepository<Entity>,
      relationName,
    );
  };

  /** Only the selects matter, MikroORM also logs transaction statements. */
  const selects = (): string[] => queries.filter((q) => q.includes('select'));
  const selectCount = (): number => selects().length;

  const entities = (count: number) => TEST_ENTITIES.slice(0, count) as TestEntity[];
  const relationsOf = (entity: TestEntity) =>
    TEST_RELATIONS.filter((r) => r.testEntityId === entity.testEntityPk);

  describe('oneToMany', () => {
    it('loads the relations of every entity with a single query', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      expect(result.size).toBe(5);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((r) => r.testRelationPk)).toEqual(
          relationsOf(dto).map((r) => r.testRelationPk),
        );
      });
    });

    it('applies the filter to the batch', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchSelectAndExecute(dtos, { filter: { testRelationPk: { like: '%-1' } } });

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((r) => r.testRelationPk)).toEqual([
          `test-relations-${dto.testEntityPk}-1`,
        ]);
      });
    });

    it('pages every entity on its own relations', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchSelectAndExecute(dtos, { paging: { limit: 2, offset: 1 } });

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((r) => r.testRelationPk)).toEqual([
          `test-relations-${dto.testEntityPk}-2`,
          `test-relations-${dto.testEntityPk}-3`,
        ]);
      });
    });

    it('sorts every entity on its own relations', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchSelectAndExecute(dtos, {
        sorting: [{ field: 'testRelationPk' as never, direction: SortDirection.DESC }],
      });

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((r) => r.testRelationPk)).toEqual([
          `test-relations-${dto.testEntityPk}-3`,
          `test-relations-${dto.testEntityPk}-2`,
          `test-relations-${dto.testEntityPk}-1`,
        ]);
      });
    });

    it('omits entities that do not exist', async () => {
      const dtos = [
        TEST_ENTITIES[0] as TestEntity,
        { testEntityPk: 'does-not-exist' } as TestEntity,
      ];
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      expect(result.get(dtos[0])).toHaveLength(3);
      expect(result.get(dtos[1])).toHaveLength(0);
    });
  });

  describe('manyToOne', () => {
    it('loads the relation of every entity with a single query', async () => {
      const dtos = TEST_RELATIONS.slice(0, 6) as TestRelation[];
      const result = await builderFor<TestRelation, TestEntity>(
        TestRelation,
        'testEntity',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((e) => e.testEntityPk)).toEqual([dto.testEntityId]);
      });
    });

    it('loads a uni-directional relation with a single query', async () => {
      const dtos = TEST_RELATIONS.slice(0, 6) as TestRelation[];
      const result = await builderFor<TestRelation, TestEntity>(
        TestRelation,
        'testEntityUniDirectional',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((e) => e.testEntityPk)).toEqual([
          dto.uniDirectionalTestEntityId,
        ]);
      });
    });
  });

  describe('oneToOne', () => {
    it('loads the owning side with a single query', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'oneTestRelation',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((r) => r.testRelationPk)).toEqual([
          `test-relations-${dto.testEntityPk}-1`,
        ]);
      });
    });

    it('loads the inverse side with a single query', async () => {
      const dtos = [TEST_RELATIONS[0], TEST_RELATIONS[3], TEST_RELATIONS[6]] as TestRelation[];
      const result = await builderFor<TestRelation, TestEntity>(
        TestRelation,
        'oneTestEntity',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)?.map((e) => e.testEntityPk)).toEqual([dto.testEntityId]);
      });
    });
  });

  describe('manyToMany', () => {
    it('loads the owning side for the whole batch without a query per entity', async () => {
      // seeded on the entities with an even numberType
      const dtos = TEST_ENTITIES.filter((e) => e.numberType! % 2 === 0).slice(0, 4) as TestEntity[];
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'manyTestRelations',
      ).batchSelectAndExecute(dtos, {});

      expect(selectCount()).toBeLessThanOrEqual(2);
      dtos.forEach((dto) => {
        expect(result.get(dto)).toHaveLength(10);
      });
    });

    it('pages the owning side per entity', async () => {
      const dtos = TEST_ENTITIES.filter((e) => e.numberType! % 2 === 0).slice(0, 4) as TestEntity[];
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'manyTestRelations',
      ).batchSelectAndExecute(dtos, { paging: { limit: 3, offset: 1 } });

      expect(selectCount()).toBeLessThanOrEqual(2);
      dtos.forEach((dto) => {
        expect(result.get(dto)).toHaveLength(3);
      });
    });
  });

  describe('#batchCount', () => {
    it('counts every entity without ever loading its relations', async () => {
      const dtos = [...entities(5), { testEntityPk: 'does-not-exist' } as TestEntity];
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchCount(dtos, {});

      // Counting must stay an aggregate, materializing the rows to measure them would make the
      // transferred data grow with the relation cardinality.
      expect(selects().length).toBeGreaterThan(0);
      selects().forEach((query) => expect(query).toContain('count('));

      expect(result.size).toBe(6);
      entities(5).forEach((dto) => expect(result.get(dto)).toBe(3));
      expect(result.get(dtos[5])).toBe(0);
    });

    it('ignores paging so the count covers every relation', async () => {
      const dtos = entities(3);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchCount(dtos, { paging: { limit: 1 } });

      dtos.forEach((dto) => expect(result.get(dto)).toBe(3));
    });
  });

  describe('#batchAggregate', () => {
    it('aggregates the relations of every entity with a single query', async () => {
      const dtos = entities(5);
      const result = await builderFor<TestEntity, TestRelation>(
        TestEntity,
        'testRelations',
      ).batchAggregate(
        dtos,
        {},
        {
          count: [{ field: 'testRelationPk', args: {} }],
          max: [{ field: 'testRelationPk', args: {} }],
        },
      );

      expect(selectCount()).toBe(1);
      dtos.forEach((dto) => {
        expect(result.get(dto)).toEqual([
          {
            COUNT_testRelationPk: 3,
            MAX_testRelationPk: `test-relations-${dto.testEntityPk}-3`,
          },
        ]);
      });
    });
  });
});
