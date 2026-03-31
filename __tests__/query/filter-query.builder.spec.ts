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
      const metadata = qb.repo
        .getEntityManager()
        .getMetadata()
        .get(qb.repo.getEntityName() as unknown as EntityName<any>);
      expect(qb.getReferencedRelationsRecursive(metadata, complexQuery)).toEqual({
        oneTestRelation: { relationOfTestRelation: {} },
      });
    });

    it('with nested and / or', () => {
      const qb = getEntityQueryBuilder(TestEntity);
      const metadata = qb.repo
        .getEntityManager()
        .getMetadata()
        .get(qb.repo.getEntityName() as unknown as EntityName<any>);
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
        expect((result.filterQuery as any).stringType.$eq).toBe('foo');
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
        expect((result.options?.orderBy as any).numberType).toBe('asc');
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
        expect((result.options?.orderBy as any).numberType.toLowerCase()).toContain('nulls first');
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
        expect((result.options?.orderBy as any).numberType.toLowerCase()).toContain('nulls last');
      });

      it('should apply DESC sorting', () => {
        const qb = getEntityQueryBuilder(TestEntity);
        const result = qb.buildFindOptions({
          sorting: [{ field: 'numberType', direction: SortDirection.DESC }],
        });
        expect((result.options?.orderBy as any).numberType).toBe('desc');
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
        expect((result.options?.orderBy as any).numberType.toLowerCase()).toContain('nulls first');
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
        expect((result.options?.orderBy as any).numberType.toLowerCase()).toContain('nulls last');
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
