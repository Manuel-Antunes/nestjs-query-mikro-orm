import type { Class } from '@nestjs-query/core';
import { SortDirection, SortNulls } from '@nestjs-query/core';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RelationQueryBuilder } from '../../src/lib/query';
import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestEntity } from '../__fixtures__/test.entity';

describe('RelationQueryBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const getRelationQueryBuilder = <Entity extends object, Relation extends object>(
    EntityClass: Class<Entity>,
    relationName: string,
  ): RelationQueryBuilder<Entity, Relation> =>
    new RelationQueryBuilder(getTestConnection().em.getRepository(EntityClass), relationName);

  describe('#select', () => {
    const testEntity: Partial<TestEntity> = {
      testEntityPk: 'test-entity-id-1',
      dateType: new Date(),
      boolType: true,
      numberType: 1,
      stringType: 'str',
    };

    const testRelation: Partial<TestRelation> = {
      testRelationPk: 'test-relation-id-1',
      relationName: 'relation-name',
    };

    it('should throw an error if there is no relation with that name', async () => {
      expect(() => {
        getRelationQueryBuilder(TestEntity, 'badRelations').selectAndExecute(
          testEntity as TestEntity,
          {},
        );
      }).toThrow("Unable to find relation 'badRelations' on entity");
    });

    describe('one to many', () => {
      it('should query with a single entity', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {},
        );
        expect(Array.isArray(res)).toBe(true);
      });
    });

    describe('many to one', () => {
      it('should work with one entity', async () => {
        const res = await getRelationQueryBuilder(TestRelation, 'testEntity').selectAndExecute(
          testRelation as TestRelation,
          {},
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should work with a uni-directional relationship', async () => {
        const res = await getRelationQueryBuilder(
          TestRelation,
          'testEntityUniDirectional',
        ).selectAndExecute(testRelation as TestRelation, {});
        expect(Array.isArray(res)).toBe(true);
      });
    });

    describe('many to many', () => {
      describe('on owning side', () => {
        it('should work with one entity', async () => {
          const res = await getRelationQueryBuilder(
            TestEntity,
            'manyTestRelations',
          ).selectAndExecute(testEntity as TestEntity, {});
          expect(Array.isArray(res)).toBe(true);
        });
      });

      describe('on non owning side', () => {
        it('should work with many to many', async () => {
          const res = await getRelationQueryBuilder(
            TestRelation,
            'manyTestEntities',
          ).selectAndExecute(testRelation as TestRelation, {});
          expect(Array.isArray(res)).toBe(true);
        });
      });

      describe('many-to-many custom join table', () => {
        it('should work with a many-to-many through a join table', async () => {
          const res = await getRelationQueryBuilder(
            TestEntity,
            'testEntityRelation',
          ).selectAndExecute(testEntity as TestEntity, {});
          expect(Array.isArray(res)).toBe(true);
        });
      });

      describe('uni-directional many to many', () => {
        it('should create the correct sql', async () => {
          const res = await getRelationQueryBuilder(
            TestEntity,
            'manyToManyUniDirectional',
          ).selectAndExecute(testEntity as TestEntity, {});
          expect(Array.isArray(res)).toBe(true);
        });
      });
    });

    describe('one to one', () => {
      it('on owning side', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'oneTestRelation').selectAndExecute(
          testEntity as TestEntity,
          {},
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('on non owning side', async () => {
        const res = await getRelationQueryBuilder(TestRelation, 'oneTestEntity').selectAndExecute(
          testRelation as TestRelation,
          {},
        );
        expect(Array.isArray(res)).toBe(true);
      });
    });

    describe('with filter', () => {
      it('should apply filter when there is a filter', async () => {
        const query = {
          filter: { relationName: { eq: 'foo' } },
        };
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          query,
        );
        expect(Array.isArray(res)).toBe(true);
      });
    });

    describe('with paging', () => {
      it('should apply paging args going forward', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          { paging: { limit: 10, offset: 11 } },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply paging args going backward', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          { paging: { limit: 10, offset: 10 } },
        );
        expect(Array.isArray(res)).toBe(true);
      });
    });

    describe('with sorting', () => {
      it('should apply ASC sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          { sorting: [{ field: 'relationName' as never, direction: SortDirection.ASC }] },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply ASC NULLS_FIRST sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {
            sorting: [
              {
                field: 'relationName' as never,
                direction: SortDirection.ASC,
                nulls: SortNulls.NULLS_FIRST,
              },
            ],
          },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply ASC NULLS_LAST sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {
            sorting: [
              {
                field: 'relationName' as never,
                direction: SortDirection.ASC,
                nulls: SortNulls.NULLS_LAST,
              },
            ],
          },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply DESC sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          { sorting: [{ field: 'relationName' as never, direction: SortDirection.DESC }] },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply DESC NULLS_FIRST sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {
            sorting: [
              {
                field: 'relationName' as never,
                direction: SortDirection.DESC,
                nulls: SortNulls.NULLS_FIRST,
              },
            ],
          },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply DESC NULLS_LAST sorting', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {
            sorting: [
              {
                field: 'relationName' as never,
                direction: SortDirection.DESC,
                nulls: SortNulls.NULLS_LAST,
              },
            ],
          },
        );
        expect(Array.isArray(res)).toBe(true);
      });

      it('should apply multiple sorts', async () => {
        const res = await getRelationQueryBuilder(TestEntity, 'testRelations').selectAndExecute(
          testEntity as TestEntity,
          {
            sorting: [
              { field: 'relationName' as never, direction: SortDirection.ASC },
              { field: 'testRelationPk' as never, direction: SortDirection.DESC },
            ],
          },
        );
        expect(Array.isArray(res)).toBe(true);
      });
    });
  });
});
