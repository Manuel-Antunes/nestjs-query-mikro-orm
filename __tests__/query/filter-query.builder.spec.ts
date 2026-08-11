import type { Class, Filter } from '@ptc-org/nestjs-query-core';
import { SortDirection, SortNulls } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WhereBuilder } from '../../src/lib/query';
import { FilterQueryBuilder } from '../../src/lib/query';
import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';
import { EntityName } from '@mikro-orm/core';

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

  /**
   * The `apply*` helpers take any object shaped like a MikroORM QueryBuilder, so a recording stub
   * is enough - and it lets the specs assert on exactly what was handed to the builder.
   */
  const queryBuilderStub = () => {
    const calls = { andWhere: [] as unknown[], orderBy: [] as unknown[], groupBy: [] as string[] };
    const qb = {
      andWhere(filter: unknown) {
        calls.andWhere.push(filter);
        return this;
      },
      orderBy(order: unknown) {
        calls.orderBy.push(order);
        return this;
      },
      groupBy(field: string) {
        calls.groupBy.push(field);
        return this;
      },
    };
    return { qb, calls };
  };

  describe('#applyFilter', () => {
    it('should hand the converted filter to the query builder', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      expect(builder.applyFilter(qb, { stringType: { eq: 'foo' } })).toBe(qb);
      expect(calls.andWhere).toEqual([{ stringType: { $eq: 'foo' } }]);
    });

    it('should leave the query builder untouched without a filter', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      expect(builder.applyFilter(qb)).toBe(qb);
      expect(calls.andWhere).toEqual([]);
    });
  });

  describe('#applySorting', () => {
    it('should build an order by from the sort fields', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      builder.applySorting(qb, [
        { field: 'stringType', direction: SortDirection.ASC },
        { field: 'numberType', direction: SortDirection.DESC },
      ]);
      expect(calls.orderBy).toEqual([{ stringType: 'asc', numberType: 'desc' }]);
    });

    it('should carry the nulls placement into the order', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      builder.applySorting(qb, [
        { field: 'stringType', direction: SortDirection.ASC, nulls: SortNulls.NULLS_FIRST },
        { field: 'numberType', direction: SortDirection.DESC, nulls: SortNulls.NULLS_LAST },
      ]);
      expect(calls.orderBy).toEqual([
        { stringType: 'asc nulls first', numberType: 'desc nulls last' },
      ]);
    });

    it('should leave the query builder untouched for no sorting', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      expect(builder.applySorting(qb)).toBe(qb);
      expect(builder.applySorting(qb, [])).toBe(qb);
      expect(calls.orderBy).toEqual([]);
    });
  });

  describe('#applyGroupBy', () => {
    it('should group by each field in turn', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      builder.applyGroupBy(qb, ['stringType', 'boolType']);
      expect(calls.groupBy).toEqual(['stringType', 'boolType']);
    });

    it('should leave the query builder untouched for no grouping', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      expect(builder.applyGroupBy(qb)).toBe(qb);
      expect(builder.applyGroupBy(qb, [])).toBe(qb);
      expect(calls.groupBy).toEqual([]);
    });
  });

  describe('#applyAggregateSorting', () => {
    it('should order ascending by every grouped field', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      builder.applyAggregateSorting(qb, ['stringType', 'boolType']);
      expect(calls.orderBy).toEqual([{ stringType: 'asc', boolType: 'asc' }]);
    });

    it('should leave the query builder untouched for no grouping', () => {
      const { qb, calls } = queryBuilderStub();
      const builder = getEntityQueryBuilder(TestEntity);

      expect(builder.applyAggregateSorting(qb)).toBe(qb);
      expect(builder.applyAggregateSorting(qb, [])).toBe(qb);
      expect(calls.orderBy).toEqual([]);
    });
  });

  describe('#filterHasRelations', () => {
    it('should be true when the filter reaches into a relation', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      expect(builder.filterHasRelations({ oneTestRelation: { relationName: { eq: 'a' } } })).toBe(
        true,
      );
    });

    it('should be false for a filter on the entity only', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      expect(builder.filterHasRelations({ stringType: { eq: 'a' } })).toBe(false);
    });

    it('should be false without a filter', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      expect(builder.filterHasRelations()).toBe(false);
    });
  });

  describe('#getReferencedRelationsRecursive', () => {
    it('should find a directly referenced relation', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      const filter: Filter<TestEntity> = { oneTestRelation: { relationName: { eq: 'a' } } };
      expect(builder.getReferencedRelationsRecursive(filter)).toEqual({ oneTestRelation: {} });
    });

    it('should ignore fields that are not relations', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      const filter: Filter<TestEntity> = { stringType: { eq: 'a' } };
      expect(builder.getReferencedRelationsRecursive(filter)).toEqual({});
    });

    it('should return nothing for an empty filter', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      expect(builder.getReferencedRelationsRecursive({})).toEqual({});
      expect(builder.getReferencedRelationsRecursive()).toEqual({});
    });

    it('should walk into the branches of an or', () => {
      const builder = getEntityQueryBuilder(TestEntity);
      const filter: Filter<TestEntity> = {
        or: [{ oneTestRelation: { relationName: { eq: 'a' } } }, { stringType: { eq: 'b' } }],
      };
      expect(builder.getReferencedRelationsRecursive(filter)).toEqual({ oneTestRelation: {} });
    });

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
      const metadata = qb.repo
        .getEntityManager()
        .getMetadata()
        .get(qb.repo.getEntityName() as unknown as EntityName<TestEntity>);
      expect(qb.getReferencedRelationsRecursive(metadata, complexQuery)).toEqual({
        oneTestRelation: { relationOfTestRelation: {} },
      });
    });

    it('with nested and / or', () => {
      const qb = getEntityQueryBuilder(TestEntity);
      const metadata = qb.repo
        .getEntityManager()
        .getMetadata()
        .get(qb.repo.getEntityName() as unknown as EntityName<TestEntity>);
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
        const result = qb.buildFindOptions({});
        expect(result.filterQuery).toBeUndefined();
        expect(result.options).toBeUndefined();
      });

      it('should apply filter when provided', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({ filter: { stringType: { eq: 'foo' } } });
        const where = result.filterQuery as Record<string, { $eq?: unknown }>;
        expect(where.stringType.$eq).toBe('foo');
      });
    });

    describe('with paging', () => {
      it('should apply empty paging args', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({});
        expect(result.options).toBeUndefined();
      });

      it('should apply paging args going forward', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({ paging: { limit: 10, offset: 11 } });
        expect(result.options?.limit).toBe(10);
        expect(result.options?.offset).toBe(11);
      });

      it('should apply paging args going backward', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({ paging: { limit: 10, offset: 10 } });
        expect(result.options?.limit).toBe(10);
        expect(result.options?.offset).toBe(10);
      });
    });

    describe('with sorting', () => {
      it('should apply ASC sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [{ field: 'numberType', direction: SortDirection.ASC }],
        });
        expect(result.options?.orderBy?.numberType).toBe('asc');
      });

      it('should apply ASC NULLS_FIRST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.ASC,
              nulls: SortNulls.NULLS_FIRST,
            },
          ],
        });
        expect(String(result.options?.orderBy?.numberType).toLowerCase()).toContain('nulls first');
      });

      it('should apply ASC NULLS_LAST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.ASC,
              nulls: SortNulls.NULLS_LAST,
            },
          ],
        });
        expect(String(result.options?.orderBy?.numberType).toLowerCase()).toContain('nulls last');
      });

      it('should apply DESC sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [{ field: 'numberType', direction: SortDirection.DESC }],
        });
        expect(result.options?.orderBy?.numberType).toBe('desc');
      });

      it('should apply DESC NULLS_FIRST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.DESC,
              nulls: SortNulls.NULLS_FIRST,
            },
          ],
        });
        expect(String(result.options?.orderBy?.numberType).toLowerCase()).toContain('nulls first');
      });

      it('should apply DESC NULLS_LAST sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [
            {
              field: 'numberType',
              direction: SortDirection.DESC,
              nulls: SortNulls.NULLS_LAST,
            },
          ],
        });
        expect(String(result.options?.orderBy?.numberType).toLowerCase()).toContain('nulls last');
      });

      it('should apply multiple sorts', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
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
        expect(Object.keys(result.options?.orderBy ?? {}).length).toBeGreaterThan(1);
      });
    });
  });
});
