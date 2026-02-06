import type { Class, Query } from '@nestjs-query/core';
import { SortDirection, SortNulls } from '@nestjs-query/core';

import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { TestRelation } from '../__fixtures__/test-relation.entity';
import { TestEntity } from '../__fixtures__/test.entity';
import { RelationQueryBuilder } from '../../src/lib/query';

describe('RelationQueryBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const getRelationQueryBuilder = <
    Entity extends object,
    Relation extends object,
  >(
    EntityClass: Class<Entity>,
    relationName: string,
  ): RelationQueryBuilder<Entity, Relation> =>
    new RelationQueryBuilder(
      getTestConnection().em.getRepository(EntityClass),
      relationName,
    );

  const getSQL = <Entity extends object, Relation extends object>(
    EntityClass: Class<Entity>,
    entity: Entity,
    relation: string,
    query: Query<Relation>,
  ): { sql: string; bindings: readonly unknown[] } => {
    const selectQueryBuilder = getRelationQueryBuilder<Entity, Relation>(
      EntityClass,
      relation,
    ).select(entity, query);
    return selectQueryBuilder.getKnexQuery().toSQL();
  };

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

    it('should throw an error if there is no relation with that name', () => {
      expect(() => {
        getSQL(TestEntity, testEntity as TestEntity, 'badRelations', {});
      }).toThrow("Unable to find relation 'badRelations' on entity");
    });

    describe('one to many', () => {
      it('should query with a single entity', () => {
        const { sql, bindings } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {},
        );
        expect(sql).toContain('select');
        expect(sql).toContain('test_relation');
        expect(bindings.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('many to one', () => {
      it('should work with one entity', () => {
        const { sql, bindings } = getSQL(
          TestRelation,
          testRelation as TestRelation,
          'testEntity',
          {},
        );
        expect(sql).toContain('select');
        expect(sql).toContain('test_entity');
        expect(bindings.length).toBeGreaterThanOrEqual(0);
      });

      it('should work with a uni-directional relationship', () => {
        const { sql, bindings } = getSQL(
          TestRelation,
          testRelation as TestRelation,
          'testEntityUniDirectional',
          {},
        );
        expect(sql).toContain('select');
        expect(sql).toContain('test_entity');
        expect(bindings.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('many to many', () => {
      describe('on owning side', () => {
        it('should work with one entity', () => {
          const { sql, bindings } = getSQL(
            TestEntity,
            testEntity as TestEntity,
            'manyTestRelations',
            {},
          );
          expect(sql).toContain('select');
          expect(bindings.length).toBeGreaterThanOrEqual(0);
        });
      });

      describe('on non owning side', () => {
        it('should work with many to many', () => {
          const { sql, bindings } = getSQL(
            TestRelation,
            testRelation as TestRelation,
            'manyTestEntities',
            {},
          );
          expect(sql).toContain('select');
          expect(bindings.length).toBeGreaterThanOrEqual(0);
        });
      });

      describe('many-to-many custom join table', () => {
        it('should work with a many-to-many through a join table', () => {
          const { sql, bindings } = getSQL(
            TestEntity,
            testEntity as TestEntity,
            'testEntityRelation',
            {},
          );
          expect(sql).toContain('select');
          expect(bindings.length).toBeGreaterThanOrEqual(0);
        });
      });

      describe('uni-directional many to many', () => {
        it('should create the correct sql', () => {
          const { sql, bindings } = getSQL(
            TestEntity,
            testEntity as TestEntity,
            'manyToManyUniDirectional',
            {},
          );
          expect(sql).toContain('select');
          expect(bindings.length).toBeGreaterThanOrEqual(0);
        });
      });
    });

    describe('one to one', () => {
      it('on owning side', () => {
        const { sql, bindings } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'oneTestRelation',
          {},
        );
        expect(sql).toContain('select');
        expect(bindings.length).toBeGreaterThanOrEqual(0);
      });

      it('on non owning side', () => {
        const { sql, bindings } = getSQL(
          TestRelation,
          testRelation as TestRelation,
          'oneTestEntity',
          {},
        );
        expect(sql).toContain('select');
        expect(bindings.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('with filter', () => {
      it('should apply filter when there is a filter', () => {
        const query: Query<TestRelation> = {
          filter: { relationName: { eq: 'foo' } },
        };
        const { sql, bindings } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          query,
        );
        expect(sql).toContain('where');
        expect(bindings).toContain('foo');
      });
    });

    describe('with paging', () => {
      it('should apply paging args going forward', () => {
        const { sql, bindings } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            paging: { limit: 10, offset: 11 },
          },
        );
        expect(sql).toContain('limit');
        expect(sql).toContain('offset');
        expect(bindings).toContain(10);
        expect(bindings).toContain(11);
      });

      it('should apply paging args going backward', () => {
        const { sql, bindings } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            paging: { limit: 10, offset: 10 },
          },
        );
        expect(sql).toContain('limit');
        expect(sql).toContain('offset');
        expect(bindings).toContain(10);
      });
    });

    describe('with sorting', () => {
      it('should apply ASC sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [{ field: 'relationName', direction: SortDirection.ASC }],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
      });

      it('should apply ASC NULLS_FIRST sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [
              {
                field: 'relationName',
                direction: SortDirection.ASC,
                nulls: SortNulls.NULLS_FIRST,
              },
            ],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
        expect(sql.toLowerCase()).toContain('nulls first');
      });

      it('should apply ASC NULLS_LAST sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [
              {
                field: 'relationName',
                direction: SortDirection.ASC,
                nulls: SortNulls.NULLS_LAST,
              },
            ],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
        expect(sql.toLowerCase()).toContain('nulls last');
      });

      it('should apply DESC sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [{ field: 'relationName', direction: SortDirection.DESC }],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
      });

      it('should apply DESC NULLS_FIRST sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [
              {
                field: 'relationName',
                direction: SortDirection.DESC,
                nulls: SortNulls.NULLS_FIRST,
              },
            ],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
        expect(sql.toLowerCase()).toContain('nulls first');
      });

      it('should apply DESC NULLS_LAST sorting', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [
              {
                field: 'relationName',
                direction: SortDirection.DESC,
                nulls: SortNulls.NULLS_LAST,
              },
            ],
          },
        );
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
        expect(sql.toLowerCase()).toContain('nulls last');
      });

      it('should apply multiple sorts', () => {
        const { sql } = getSQL(
          TestEntity,
          testEntity as TestEntity,
          'testRelations',
          {
            sorting: [
              { field: 'relationName', direction: SortDirection.ASC },
              { field: 'testRelationPk', direction: SortDirection.DESC },
            ],
          },
        );
        expect(sql).toContain('order by');
      });
    });
  });
});
