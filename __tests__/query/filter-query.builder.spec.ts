import type { QueryBuilder } from '@mikro-orm/knex';
import type { Class, Filter } from '@nestjs-query/core';
import { SortDirection, SortNulls } from '@nestjs-query/core';

import type { WhereBuilder } from '../../src/lib/query';
import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';
import { FilterQueryBuilder } from '../../src/lib/query';

describe('FilterQueryBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const getEntityQueryBuilder = <Entity extends object>(
    entity: Class<Entity>,
    whereBuilder?: WhereBuilder<Entity>,
  ): FilterQueryBuilder<Entity> => {
    const repo = getTestConnection().em.getRepository(entity);
    return new FilterQueryBuilder(repo, whereBuilder);
  };

  const getSQL = <Entity extends object>(
    qb: QueryBuilder<Entity>,
  ): { sql: string; bindings: readonly unknown[] } => {
    return qb.getKnexQuery().toSQL();
  };

  describe('#getReferencedRelationsRecursive', () => {
    it('with deeply nested and / or', () => {
      const complexQuery: Filter<TestEntity> = {
        and: [
          {
            or: [
              { and: [{ stringType: { eq: '123' } }] },
              {
                and: [{ stringType: { eq: '123' } }],
              },
            ],
          },
          {
            stringType: { eq: '345' },
            or: [
              { oneTestRelation: { relationName: { eq: '123' } } },
              {
                oneTestRelation: {
                  relationOfTestRelation: { testRelationId: { eq: 'e1' } },
                },
              },
            ],
          },
        ],
      };
      const qb = getEntityQueryBuilder(TestEntity);
      const metadata = qb.repo.getEntityManager().getMetadata().get(qb.repo.getEntityName());
      expect(qb.getReferencedRelationsRecursive(metadata, complexQuery)).toEqual({
        oneTestRelation: { relationOfTestRelation: {} },
      });
    });

    it('with nested and / or', () => {
      const qb = getEntityQueryBuilder(TestEntity);
      const metadata = qb.repo.getEntityManager().getMetadata().get(qb.repo.getEntityName());
      expect(
        qb.getReferencedRelationsRecursive(metadata, {
          and: [
            {
              boolType: { is: true },
            },
            {
              testRelations: {
                relationName: { eq: '123' },
              },
            },
          ],
          or: [
            {
              boolType: { is: true },
            },
            {
              oneTestRelation: {
                testRelationPk: { eq: '123' },
              },
            },
            {
              oneTestRelation: {
                relationsOfTestRelation: {
                  testRelationId: {
                    eq: '123',
                  },
                },
              },
            },
          ],
        } as Filter<TestEntity>),
      ).toEqual({
        testRelations: {},
        oneTestRelation: { relationsOfTestRelation: {} },
      });
    });
  });

  describe('#select', () => {
    describe('with filter', () => {
      it('should create a query without filter when not provided', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({});
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('select');
        expect(sql).toContain('test_entity');
      });

      it('should apply filter when provided', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({ filter: { stringType: { eq: 'foo' } } });
        const { sql, bindings } = getSQL(selectQb);
        expect(sql).toContain('where');
        expect(bindings).toContain('foo');
      });
    });

    describe('with paging', () => {
      it('should apply empty paging args', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({});
        const { sql } = getSQL(selectQb);
        expect(sql).not.toContain('limit');
        expect(sql).not.toContain('offset');
      });

      it('should apply paging args going forward', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({ paging: { limit: 10, offset: 11 } });
        const { sql, bindings } = getSQL(selectQb);
        expect(sql).toContain('limit');
        expect(sql).toContain('offset');
        expect(bindings).toContain(10);
        expect(bindings).toContain(11);
      });

      it('should apply paging args going backward', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({ paging: { limit: 10, offset: 10 } });
        const { sql, bindings } = getSQL(selectQb);
        expect(sql).toContain('limit');
        expect(sql).toContain('offset');
        expect(bindings).toContain(10);
      });
    });

    describe('with sorting', () => {
      it('should apply ASC sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [{ field: 'numberType', direction: SortDirection.ASC }],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
      });

      it('should apply ASC NULLS_FIRST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.ASC,
              nulls: SortNulls.NULLS_FIRST,
            },
          ],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
        expect(sql.toLowerCase()).toContain('nulls first');
      });

      it('should apply ASC NULLS_LAST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.ASC,
              nulls: SortNulls.NULLS_LAST,
            },
          ],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('asc');
        expect(sql.toLowerCase()).toContain('nulls last');
      });

      it('should apply DESC sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [{ field: 'numberType', direction: SortDirection.DESC }],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
      });

      it('should apply DESC NULLS_FIRST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.DESC,
              nulls: SortNulls.NULLS_FIRST,
            },
          ],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
        expect(sql.toLowerCase()).toContain('nulls first');
      });

      it('should apply DESC NULLS_LAST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.DESC,
              nulls: SortNulls.NULLS_LAST,
            },
          ],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
        expect(sql.toLowerCase()).toContain('desc');
        expect(sql.toLowerCase()).toContain('nulls last');
      });

      it('should apply multiple sorts', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const selectQb = qb.select({
          sorting: [
            { field: 'numberType', direction: SortDirection.ASC },
            { field: 'boolType', direction: SortDirection.DESC },
            {
              field: 'stringType',
              direction: SortDirection.ASC,
              nulls: SortNulls.NULLS_FIRST,
            },
            {
              field: 'dateType',
              direction: SortDirection.DESC,
              nulls: SortNulls.NULLS_LAST,
            },
          ],
        });
        const { sql } = getSQL(selectQb);
        expect(sql).toContain('order by');
      });
    });
  });
});
