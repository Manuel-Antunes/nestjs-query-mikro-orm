import type { EntityRepository } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/core';
import { getRepositoryToken, MikroOrmModule } from '@mikro-orm/nestjs';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Filter } from '@ptc-org/nestjs-query-core';
import { SortDirection } from '@ptc-org/nestjs-query-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MikroOrmQueryService } from '../../src';
import { FilterQueryBuilder } from '../../src/lib/query';
import {
  CONNECTION_OPTIONS,
  CustomHydrator,
  truncate,
} from '../__fixtures__/not-managed/connection.fixture';
import { RelationOfTestRelationSchema } from '../__fixtures__/not-managed/relation-of-test-relation.entity';
import {
  seed,
  TEST_ENTITIES,
  TEST_RELATIONS,
  TEST_SOFT_DELETE_ENTITIES,
} from '../__fixtures__/not-managed/seeds';
import { TestEntityRelationSchema } from '../__fixtures__/not-managed/test-entity-relation.entity';
import { TestRelation, TestRelationSchema } from '../__fixtures__/not-managed/test-relation.entity';
import {
  TestSoftDeleteEntity,
  TestSoftDeleteSchema,
} from '../__fixtures__/not-managed/test-soft-delete.entity';
import { TestEntity, TestSchema } from '../__fixtures__/not-managed/test.entity';

// Import assemblers to register them with @nestjs-query

describe('MikroOrmQueryService (Not Managed)', (): void => {
  let moduleRef: TestingModule;
  let orm: MikroORM;

  /** Helper to truncate all tables - clears ORM identity map to avoid stale cached entities */

  class TestEntityService extends MikroOrmQueryService<TestEntity> {
    constructor(override readonly repo: EntityRepository<TestEntity>) {
      super(repo);
    }
  }

  class TestRelationService extends MikroOrmQueryService<TestRelation> {
    constructor(override readonly repo: EntityRepository<TestRelation>) {
      super(repo);
    }
  }

  class TestSoftDeleteEntityService extends MikroOrmQueryService<TestSoftDeleteEntity> {
    constructor(override readonly repo: EntityRepository<TestSoftDeleteEntity>) {
      super(repo, { useSoftDelete: true });
    }
  }

  afterEach(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot({
          ...CONNECTION_OPTIONS,
          allowGlobalContext: true,
          hydrator: CustomHydrator,
          propagationOnPrototype: false,
          entities: [
            TestSchema,
            TestRelationSchema,
            TestEntityRelationSchema,
            TestSoftDeleteSchema,
            RelationOfTestRelationSchema,
          ],
        }),
        MikroOrmModule.forFeature([
          TestSchema,
          TestRelationSchema,
          TestEntityRelationSchema,
          TestSoftDeleteSchema,
          RelationOfTestRelationSchema,
        ]),
      ],
      providers: [
        {
          provide: TestEntityService,
          useFactory: (repo: EntityRepository<TestEntity>) => new TestEntityService(repo),
          inject: [getRepositoryToken(TestEntity)],
        },
        {
          provide: TestRelationService,
          useFactory: (repo: EntityRepository<TestRelation>) => new TestRelationService(repo),
          inject: [getRepositoryToken(TestRelation)],
        },
        {
          provide: TestSoftDeleteEntityService,
          useFactory: (repo: EntityRepository<TestSoftDeleteEntity>) =>
            new TestSoftDeleteEntityService(repo),
          inject: [getRepositoryToken(TestSoftDeleteEntity)],
        },
      ],
    }).compile();

    // Create schema and seed data using the NestJS managed ORM instance
    orm = moduleRef.get(MikroORM);
    await orm.schema.create();
    await seed(orm);
  });

  it('should create a filterQueryBuilder and assemblerService based on the repo passed in if not provided', () => {
    const queryService = moduleRef.get(TestEntityService);
    expect(queryService.filterQueryBuilder).toBeInstanceOf(FilterQueryBuilder);
    expect(queryService.filterQueryBuilder.repo.getEntityName()).toBe('TestEntity');
  });

  describe('#query', () => {
    it('call select and return the result', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.query({
        filter: { stringType: { eq: 'foo1' } },
      });
      const serialized = queryResult;
      expect(serialized).toHaveLength(1);
      expect(serialized[0]).toMatchObject(TEST_ENTITIES[0]);
    });

    describe('filter on relations', () => {
      describe('deeply nested', () => {
        it('oneToOne - oneToMany', async () => {
          const entity = TEST_ENTITIES[0];
          const relationEntity = TEST_RELATIONS.find((r) => r.testEntityId === entity.id);
          expect(relationEntity).toBeDefined();
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              oneTestRelation: {
                relationsOfTestRelation: {
                  testRelation: {
                    id: {
                      eq: relationEntity?.id,
                    },
                  },
                },
              } as any,
            },
          });
          expect(queryResult).toHaveLength(1);
          expect(queryResult[0]).toMatchObject(entity);
        });
        it('oneToOne - manyToOne', async () => {
          const entity = TEST_ENTITIES[0];
          const relationEntity = TEST_RELATIONS.find((r) => r.testEntityId === entity.id);
          expect(relationEntity).toBeDefined();
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              oneTestRelation: {
                relationsOfTestRelation: {
                  testRelation: {
                    id: {
                      eq: relationEntity?.id,
                    },
                  },
                },
              },
            },
          });
          expect(queryResult).toHaveLength(1);
          expect(queryResult[0]).toMatchObject(entity);
        });
      });
      describe('oneToOne', () => {
        it('should allow filtering on a one to one relation', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              oneTestRelation: {
                id: {
                  in: [`test-relations-${entity.id}-1`, `test-relations-${entity.id}-3`],
                },
              },
            },
          });
          expect(queryResult).toHaveLength(1);
          expect(queryResult[0]).toMatchObject(entity);
        });

        it('should allow filtering on a one to one relation with an OR clause', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              or: [
                { id: { eq: TEST_ENTITIES[1].id } },
                {
                  oneTestRelation: {
                    id: {
                      in: [`test-relations-${entity.id}-1`, `test-relations-${entity.id}-3`],
                    },
                  },
                },
              ],
            },
            sorting: [{ field: 'id', direction: SortDirection.ASC }],
            paging: { limit: 2 },
          });
          expect(queryResult).toHaveLength(2);
          expect(queryResult[0]).toMatchObject(entity);
          expect(queryResult[1]).toMatchObject(TEST_ENTITIES[1]);
        });
      });

      describe('manyToOne', () => {
        it('should allow filtering on a many to one relation', async () => {
          const queryService = moduleRef.get(TestRelationService);
          const queryResults = await queryService.query({
            filter: {
              testEntity: {
                id: {
                  in: [TEST_ENTITIES[0].id!, TEST_ENTITIES[1].id!],
                },
              },
            },
          });
          const serialized = queryResults;
          expect(serialized).toHaveLength(6);
          serialized.map((e: any, idx: number) => {
            expect(e).toMatchObject(TEST_RELATIONS[idx]);
          });
        });

        it('should allow filtering on a uni directional many to one relation', async () => {
          const queryService = moduleRef.get(TestRelationService);
          const queryResults = await queryService.query({
            filter: {
              testEntityUniDirectional: {
                id: {
                  in: [TEST_ENTITIES[0].id!, TEST_ENTITIES[1].id!],
                },
              },
            },
          });
          const serialized = queryResults;
          expect(serialized).toHaveLength(6);
          serialized.map((e: any, idx: number) => {
            expect(e).toMatchObject(TEST_RELATIONS[idx]);
          });
        });

        it('should allow filtering on a many to one relation with paging', async () => {
          const queryService = moduleRef.get(TestRelationService);
          const queryResults = await queryService.query({
            filter: {
              or: [
                { id: { eq: TEST_RELATIONS[6].id } },
                {
                  testEntity: {
                    id: {
                      in: [TEST_ENTITIES[0].id!, TEST_ENTITIES[1].id!],
                    },
                  },
                },
              ],
            },
            sorting: [{ field: 'id', direction: SortDirection.ASC }],
            paging: { limit: 3 },
          });
          const serialized = queryResults;
          expect(serialized).toHaveLength(3);
          serialized.map((e: any, idx: number) => {
            expect(e).toMatchObject(TEST_RELATIONS[idx]);
          });
        });
      });

      describe('oneToMany', () => {
        it('should allow filtering on a many to one relation', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              testRelations: {
                relationName: {
                  in: [TEST_RELATIONS[0].relationName, TEST_RELATIONS[1].relationName],
                },
              } as any,
            },
          });
          expect(queryResult).toHaveLength(1);
          expect(queryResult[0]).toMatchObject(entity);
        });
        it('should allow filtering on a one to many relation with paging', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              or: [
                { id: { eq: TEST_ENTITIES[1].id } },
                {
                  testRelations: {
                    id: {
                      in: [`test-relations-${entity.id}-1`, `test-relations-${entity.id}-3`],
                    },
                  } as any,
                },
              ],
            },
            sorting: [{ field: 'id', direction: SortDirection.ASC }],
            paging: { limit: 2 },
          });
          expect(queryResult).toHaveLength(2);
          expect(queryResult[0]).toMatchObject(entity);
          expect(queryResult[1]).toMatchObject(TEST_ENTITIES[1]);
        });
      });

      describe('manyToMany', () => {
        it('should allow filtering on a many to many relation', async () => {
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              manyTestRelations: {
                relationName: {
                  in: [TEST_RELATIONS[1].relationName, TEST_RELATIONS[4].relationName],
                },
              } as any,
            },
          });
          expect(queryResult).toHaveLength(5);
          expect(queryResult[0]).toMatchObject(TEST_ENTITIES[1]);
          expect(queryResult[1]).toMatchObject(TEST_ENTITIES[3]);
          expect(queryResult[2]).toMatchObject(TEST_ENTITIES[5]);
          expect(queryResult[3]).toMatchObject(TEST_ENTITIES[7]);
          expect(queryResult[4]).toMatchObject(TEST_ENTITIES[9]);
        });

        it('should allow filtering on a many to many uni-directional relation', async () => {
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              manyToManyUniDirectional: {
                relationName: {
                  in: [TEST_RELATIONS[2].relationName, TEST_RELATIONS[5].relationName],
                },
              } as any,
            },
          });
          expect(queryResult).toHaveLength(3);
          expect(queryResult[0]).toMatchObject(TEST_ENTITIES[2]);
          expect(queryResult[1]).toMatchObject(TEST_ENTITIES[5]);
          expect(queryResult[2]).toMatchObject(TEST_ENTITIES[8]);
        });
        it('should allow filtering on a many to many relation with paging', async () => {
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = await queryService.query({
            filter: {
              or: [
                { id: { eq: TEST_ENTITIES[2].id } },
                {
                  manyTestRelations: {
                    relationName: {
                      in: [TEST_RELATIONS[1].relationName, TEST_RELATIONS[4].relationName],
                    },
                  } as any,
                },
              ],
            },
            sorting: [{ field: 'numberType', direction: SortDirection.ASC }],
            paging: { limit: 6 },
          });
          expect(queryResult).toHaveLength(6);
          expect(queryResult[0]).toMatchObject(TEST_ENTITIES[1]);
          expect(queryResult[1]).toMatchObject(TEST_ENTITIES[2]); // additional one from the or
          expect(queryResult[2]).toMatchObject(TEST_ENTITIES[3]);
          expect(queryResult[3]).toMatchObject(TEST_ENTITIES[5]);
          expect(queryResult[4]).toMatchObject(TEST_ENTITIES[7]);
          expect(queryResult[5]).toMatchObject(TEST_ENTITIES[9]);
        });
      });
    });
  });

  describe('#aggregate', () => {
    it('call select with the aggregate columns and return the result', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.aggregate(
        {},
        {
          count: ['id'],
          avg: ['numberType'],
          sum: ['numberType'],
          max: ['id', 'dateType', 'numberType', 'stringType'],
          min: ['id', 'dateType', 'numberType', 'stringType'],
        },
      );
      return expect(queryResult).toEqual([
        {
          avg: {
            numberType: 5.5,
          },
          count: {
            id: 10,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 10,
            stringType: 'foo9',
            id: 'test-entity-9',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 1,
            stringType: 'foo1',
            id: 'test-entity-1',
          },
          sum: {
            numberType: 55,
          },
        },
      ]);
    });

    it('call aggregate with a group by', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.aggregate(
        {},
        {
          groupBy: ['boolType'],
          count: ['id'],
          avg: ['numberType'],
          sum: ['numberType'],
          max: ['id', 'dateType', 'numberType', 'stringType'],
          min: ['id', 'dateType', 'numberType', 'stringType'],
        },
      );
      return expect(queryResult).toEqual([
        {
          groupBy: {
            boolType: 0,
          },
          avg: {
            numberType: 5,
          },
          count: {
            id: 5,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 9,
            stringType: 'foo9',
            id: 'test-entity-9',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 1,
            stringType: 'foo1',
            id: 'test-entity-1',
          },
          sum: {
            numberType: 25,
          },
        },
        {
          groupBy: {
            boolType: 1,
          },
          avg: {
            numberType: 6,
          },
          count: {
            id: 5,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 10,
            stringType: 'foo8',
            id: 'test-entity-8',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 2,
            stringType: 'foo10',
            id: 'test-entity-10',
          },
          sum: {
            numberType: 30,
          },
        },
      ]);
    });

    it('call select with the aggregate columns and return the result with a filter', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.aggregate(
        { stringType: { in: ['foo1', 'foo2', 'foo3'] } },
        {
          count: ['id'],
          avg: ['numberType'],
          sum: ['numberType'],
          max: ['id', 'dateType', 'numberType', 'stringType'],
          min: ['id', 'dateType', 'numberType', 'stringType'],
        },
      );
      return expect(queryResult).toEqual([
        {
          avg: {
            numberType: 2,
          },
          count: {
            id: 3,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 3,
            stringType: 'foo3',
            id: 'test-entity-3',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 1,
            stringType: 'foo1',
            id: 'test-entity-1',
          },
          sum: {
            numberType: 6,
          },
        },
      ]);
    });

    it('call aggregate with a group and filter', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.aggregate(
        { stringType: { in: ['foo1', 'foo2', 'foo3'] } },
        {
          groupBy: ['boolType'],
          count: ['id'],
          avg: ['numberType'],
          sum: ['numberType'],
          max: ['id', 'dateType', 'numberType', 'stringType'],
          min: ['id', 'dateType', 'numberType', 'stringType'],
        },
      );
      return expect(queryResult).toEqual([
        {
          groupBy: {
            boolType: 0,
          },
          avg: {
            numberType: 2,
          },
          count: {
            id: 2,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 3,
            stringType: 'foo3',
            id: 'test-entity-3',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 1,
            stringType: 'foo1',
            id: 'test-entity-1',
          },
          sum: {
            numberType: 4,
          },
        },
        {
          groupBy: {
            boolType: 1,
          },
          avg: {
            numberType: 2,
          },
          count: {
            id: 1,
          },
          max: {
            dateType: expect.any(Number),
            numberType: 2,
            stringType: 'foo2',
            id: 'test-entity-2',
          },
          min: {
            dateType: expect.any(Number),
            numberType: 2,
            stringType: 'foo2',
            id: 'test-entity-2',
          },
          sum: {
            numberType: 2,
          },
        },
      ]);
    });
  });

  describe('#count', () => {
    it('call select and return the result', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.count({
        stringType: { like: 'foo%' },
      });
      return expect(queryResult).toBe(10);
    });

    describe('with relations', () => {
      describe('oneToOne', () => {
        it('should properly count the number pf records with the associated relations', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          const count = await queryService.count({
            oneTestRelation: {
              id: {
                in: [`test-relations-${entity.id}-1`, `test-relations-${entity.id}-3`],
              },
            },
          });
          expect(count).toBe(1);
        });
      });

      describe('manyToOne', () => {
        it('set the relation to null', async () => {
          const queryService = moduleRef.get(TestRelationService);
          const count = await queryService.count({
            testEntity: {
              id: {
                in: [TEST_ENTITIES[0].id, TEST_ENTITIES[2].id],
              },
            },
          });
          expect(count).toBe(6);
        });
      });

      describe('oneToMany', () => {
        it('set the relation to null', async () => {
          const relation = TEST_RELATIONS[0];
          const queryService = moduleRef.get(TestEntityService);
          const count = await queryService.count({
            testRelations: {
              testEntity: {
                id: {
                  in: [relation.testEntityId as string],
                },
              },
            } as any,
          });
          expect(count).toBe(1);
        });
      });
    });
  });

  describe('#queryRelations', () => {
    describe('with one entity', () => {
      it('call select and return the result', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0] as TestEntity,
          {},
        );
        const serialized = queryResult;
        expect((serialized as TestRelation[]).map((r: any) => r.testEntityId)).toEqual([
          TEST_ENTITIES[0].id,
          TEST_ENTITIES[0].id,
          TEST_ENTITIES[0].id,
        ]);
      });

      it('should apply a filter', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0] as TestEntity,
          {
            filter: { id: { like: '%-1' } },
          },
        );
        const serialized = queryResult;
        expect((serialized as TestRelation[]).map((r: any) => r.id)).toEqual([
          TEST_RELATIONS[0].id,
        ]);
      });

      it('should apply a paging', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0] as TestEntity,
          {
            paging: { limit: 2, offset: 1 },
          },
        );
        const serialized = queryResult;
        expect((serialized as TestRelation[]).map((r: any) => r.id)).toEqual([
          TEST_RELATIONS[1].id,
          TEST_RELATIONS[2].id,
        ]);
      });

      describe('manyToMany', () => {
        it('call select and return the with a uni-directional relation', async () => {
          const entity = TEST_ENTITIES[2];
          const queryService = moduleRef.get(TestEntityService);
          const queryResult = (
            await queryService.queryRelations(
              TestRelation,
              'manyToManyUniDirectional',
              entity as TestEntity,
              {},
            )
          ).map((r: TestRelation) => {
            delete r.relationOfTestRelationId;
            return r;
          });
          const serialized = queryResult;

          TEST_RELATIONS.filter((tr) => tr.relationName?.endsWith('three')).forEach((tr) => {
            expect(serialized).toEqual(expect.arrayContaining([expect.objectContaining(tr)]));
          });
        });
      });
    });

    describe('with multiple entities', () => {
      it('call select and return the result', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          entities as TestEntity[],
          {},
        );

        expect((queryResult as Map<any, any>).size).toBe(3);
        entities.forEach((e) => {
          const relations = (queryResult as Map<any, TestRelation[]>).get(e as TestEntity);
          const serialized = relations;
          expect(serialized).toHaveLength(3);
        });
      });

      it('should apply a filter', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          entities as TestEntity[],
          {
            filter: { id: { like: '%-1' } },
          },
        );

        expect((queryResult as Map<any, any>).size).toBe(3);
        entities.forEach((e) => {
          const relations = (queryResult as Map<any, TestRelation[]>).get(e as TestEntity);
          const serialized = relations;
          expect(serialized).toHaveLength(1);
        });
      });

      it('should apply paging', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          entities as TestEntity[],
          {
            paging: { limit: 2, offset: 1 },
          },
        );

        expect((queryResult as Map<any, any>).size).toBe(3);
        entities.forEach((e) => {
          const relations = (queryResult as Map<any, TestRelation[]>).get(e as TestEntity);
          const serialized = relations;
          expect(serialized).toHaveLength(2);
        });
      });

      it('should return an empty array if no results are found.', async () => {
        const entities: TestEntity[] = [
          TEST_ENTITIES[0] as TestEntity,
          { id: 'does-not-exist' } as TestEntity,
        ];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          entities,
          {
            filter: { relationName: { isNot: null } },
          },
        );

        expect((queryResult as Map<any, any>).size).toBe(1); // Only includes entities with relations
        const result0 = (queryResult as Map<any, TestRelation[]>).get(entities[0]);
        const serialized = result0;
        expect(serialized).toHaveLength(3);
        expect((queryResult as Map<any, TestRelation[]>).get(entities[1])).toBeUndefined();
      });
    });
  });

  describe('#aggregateRelations', () => {
    describe('with one entity', () => {
      it('call select and return the result', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const aggResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0] as TestEntity,
          {},
          { count: ['id'] },
        );
        return expect(aggResult).toEqual([
          {
            count: {
              id: 3,
            },
          },
        ]);
      });

      it('should apply a filter', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const aggResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0] as TestEntity,
          { id: { like: '%-1' } },
          { count: ['id'] },
        );
        return expect(aggResult).toEqual([
          {
            count: {
              id: 1,
            },
          },
        ]);
      });
    });

    describe('with multiple entities', () => {
      it('aggregate for each entities relation', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          entities as TestEntity[],
          {},
          {
            count: ['id', 'relationName', 'testEntityId'],
            min: ['id', 'relationName', 'testEntityId'],
            max: ['id', 'relationName', 'testEntityId'],
          },
        );

        expect((queryResult as Map<any, any>).size).toBe(3);
        expect(queryResult).toEqual(
          new Map([
            [
              entities[0],
              [
                {
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo1-test-relation-two',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-3',
                  },
                  min: {
                    relationName: 'foo1-test-relation-one',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-1',
                  },
                },
              ],
            ],
            [
              entities[1],
              [
                {
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo2-test-relation-two',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-3',
                  },
                  min: {
                    relationName: 'foo2-test-relation-one',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-1',
                  },
                },
              ],
            ],
            [
              entities[2],
              [
                {
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo3-test-relation-two',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-3',
                  },
                  min: {
                    relationName: 'foo3-test-relation-one',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-1',
                  },
                },
              ],
            ],
          ]),
        );
      });

      it('aggregate and group for each entities relation', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          entities,
          {},
          {
            groupBy: ['testEntityId'],
            count: ['id', 'relationName', 'testEntityId'],
            min: ['id', 'relationName', 'testEntityId'],
            max: ['id', 'relationName', 'testEntityId'],
          },
        );

        expect(queryResult.size).toBe(3);
        expect(queryResult).toEqual(
          new Map([
            [
              entities[0],
              [
                {
                  groupBy: {
                    testEntityId: 'test-entity-1',
                  },
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo1-test-relation-two',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-3',
                  },
                  min: {
                    relationName: 'foo1-test-relation-one',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-1',
                  },
                },
              ],
            ],
            [
              entities[1],
              [
                {
                  groupBy: {
                    testEntityId: 'test-entity-2',
                  },
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo2-test-relation-two',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-3',
                  },
                  min: {
                    relationName: 'foo2-test-relation-one',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-1',
                  },
                },
              ],
            ],
            [
              entities[2],
              [
                {
                  groupBy: {
                    testEntityId: 'test-entity-3',
                  },
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo3-test-relation-two',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-3',
                  },
                  min: {
                    relationName: 'foo3-test-relation-one',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-1',
                  },
                },
              ],
            ],
          ]),
        );
      });

      it('should apply a filter', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          entities,
          { id: { like: '%-1' } },
          {
            count: ['id', 'relationName', 'testEntityId'],
            min: ['id', 'relationName', 'testEntityId'],
            max: ['id', 'relationName', 'testEntityId'],
          },
        );

        expect(queryResult.size).toBe(3);
        expect(queryResult).toEqual(
          new Map([
            [
              entities[0],
              [
                {
                  count: {
                    relationName: 1,
                    testEntityId: 1,
                    id: 1,
                  },
                  max: {
                    relationName: 'foo1-test-relation-one',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-1',
                  },
                  min: {
                    relationName: 'foo1-test-relation-one',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-1',
                  },
                },
              ],
            ],
            [
              entities[1],
              [
                {
                  count: {
                    relationName: 1,
                    testEntityId: 1,
                    id: 1,
                  },
                  max: {
                    relationName: 'foo2-test-relation-one',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-1',
                  },
                  min: {
                    relationName: 'foo2-test-relation-one',
                    testEntityId: 'test-entity-2',
                    id: 'test-relations-test-entity-2-1',
                  },
                },
              ],
            ],
            [
              entities[2],
              [
                {
                  count: {
                    relationName: 1,
                    testEntityId: 1,
                    id: 1,
                  },
                  max: {
                    relationName: 'foo3-test-relation-one',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-1',
                  },
                  min: {
                    relationName: 'foo3-test-relation-one',
                    testEntityId: 'test-entity-3',
                    id: 'test-relations-test-entity-3-1',
                  },
                },
              ],
            ],
          ]),
        );
      });

      it('should return an empty array if no results are found.', async () => {
        const entities: TestEntity[] = [TEST_ENTITIES[0], { id: 'does-not-exist' } as TestEntity];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.aggregateRelations(
          TestRelation,
          'testRelations',
          entities,
          { relationName: { isNot: null } },
          {
            count: ['id', 'relationName', 'testEntityId'],
            min: ['id', 'relationName', 'testEntityId'],
            max: ['id', 'relationName', 'testEntityId'],
          },
        );

        expect(queryResult).toEqual(
          new Map([
            [
              entities[0],
              [
                {
                  count: {
                    relationName: 3,
                    testEntityId: 3,
                    id: 3,
                  },
                  max: {
                    relationName: 'foo1-test-relation-two',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-3',
                  },
                  min: {
                    relationName: 'foo1-test-relation-one',
                    testEntityId: 'test-entity-1',
                    id: 'test-relations-test-entity-1-1',
                  },
                },
              ],
            ],
            [
              { id: 'does-not-exist' } as TestEntity,
              [
                {
                  count: {
                    relationName: 0,
                    testEntityId: 0,
                    id: 0,
                  },
                  max: {
                    relationName: null,
                    testEntityId: null,
                    id: null,
                  },
                  min: {
                    relationName: null,
                    testEntityId: null,
                    id: null,
                  },
                },
              ],
            ],
          ]),
        );
      });
    });
  });

  describe('#countRelations', () => {
    describe('with one entity', () => {
      it('call count and return the result', async () => {
        const queryService = moduleRef.get(TestEntityService);
        const countResult = await queryService.countRelations(
          TestRelation,
          'testRelations',
          TEST_ENTITIES[0],
          {
            relationName: { isNot: null },
          },
        );
        return expect(countResult).toBe(3);
      });
    });

    describe('with multiple entities', () => {
      it('call count and return the result', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.countRelations(
          TestRelation,
          'testRelations',
          entities,
          {
            relationName: { isNot: null },
          },
        );

        expect(queryResult).toEqual(
          new Map([
            [entities[0], 3],
            [entities[1], 3],
            [entities[2], 3],
          ]),
        );
      });
    });
  });

  describe('#findRelation', () => {
    describe('with one entity', () => {
      it('call select and return the result', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entity,
        );
        const serialized = queryResult;

        expect(serialized).toMatchObject(TEST_RELATIONS[0]);
      });

      it('apply the filter option', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult1 = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entity,
          {
            filter: { relationName: { eq: TEST_RELATIONS[0].relationName } },
          },
        );
        const serialized1 = queryResult1 ? queryResult1 : queryResult1;
        expect(serialized1).toMatchObject(TEST_RELATIONS[0]);

        const queryResult2 = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entity,
          {
            filter: { relationName: { eq: TEST_RELATIONS[1].relationName } },
          },
        );
        expect(queryResult2).toBeUndefined();
      });

      it('should return undefined select if no results are found.', async () => {
        const entity = { ...TEST_ENTITIES[0], id: 'not-real' };
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entity,
        );

        expect(queryResult).toBeUndefined();
      });

      it('throw an error if a relation with that name is not found.', async () => {
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.findRelation(TestRelation, 'badRelation', TEST_ENTITIES[0]),
        ).rejects.toThrow('Unable to find relation badRelation on TestEntity');
      });

      describe('manyToOne', () => {
        it('call select and return the with a uni-directional relation', async () => {
          const entity = TEST_RELATIONS[0];
          const queryService = moduleRef.get(TestRelationService);
          const queryResult = await queryService.findRelation(
            TestEntity,
            'testEntityUniDirectional',
            entity,
          );
          const serialized = queryResult;

          expect(serialized).toMatchObject(TEST_ENTITIES[0]);
        });
      });
    });

    describe('with multiple entities', () => {
      it('call select and return the result', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entities,
        );

        const adaptedQueryResult = new Map();
        queryResult.forEach((entry, key) => {
          const serialized = entry;
          delete serialized?.relationOfTestRelationId;
          adaptedQueryResult.set(key, serialized);
        });

        // Use toMatchObject since JOIN-based queries may populate additional relation fields
        adaptedQueryResult.forEach((value, key) => {
          const expectedIndex = entities.indexOf(key);
          const expectedRelation =
            expectedIndex === 0
              ? TEST_RELATIONS[0]
              : expectedIndex === 1
                ? TEST_RELATIONS[3]
                : TEST_RELATIONS[6];
          expect(value).toMatchObject(expectedRelation);
        });
      });

      it('should apply the filter option', async () => {
        const entities = TEST_ENTITIES.slice(0, 3);
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entities,
          {
            filter: {
              id: {
                in: [TEST_RELATIONS[0].id, TEST_RELATIONS[6].id],
              },
            },
          },
        );
        const adaptedQueryResult = new Map();
        queryResult.forEach((entry, key) => {
          const serialized = entry;
          delete serialized?.relationOfTestRelationId;
          adaptedQueryResult.set(key, serialized);
        });
        // Use toMatchObject since JOIN-based queries may populate additional relation fields
        expect(adaptedQueryResult.size).toBe(2);
        expect(adaptedQueryResult.get(entities[0])).toMatchObject(TEST_RELATIONS[0]);
        expect(adaptedQueryResult.get(entities[2])).toMatchObject(TEST_RELATIONS[6]);
      });

      it('should return undefined select if no results are found.', async () => {
        const entities: TestEntity[] = [TEST_ENTITIES[0], { id: 'does-not-exist' } as TestEntity];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.findRelation(
          TestRelation,
          'oneTestRelation',
          entities,
        );
        const adaptedQueryResult = new Map();
        queryResult.forEach((entry, key) => {
          const serialized = entry;
          delete serialized?.relationOfTestRelationId;
          adaptedQueryResult.set(key, serialized);
        });
        expect(adaptedQueryResult.size).toBe(1); // Only includes entities with relations
        expect(adaptedQueryResult.get(entities[0])).toMatchObject(TEST_RELATIONS[0]);
        expect(adaptedQueryResult.get(entities[1])).toBeUndefined();
      });
    });
  });

  describe('#addRelations', () => {
    it('call select and return the result', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.addRelations(
        'testRelations',
        entity.id,
        TEST_RELATIONS.slice(3, 6).map((r) => r.id),
      );
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations).toHaveLength(6);
    });

    it('should not modify if the relationIds is empty', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.addRelations('testRelations', entity.id, []);
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations).toHaveLength(3);
    });

    describe('with modify options', () => {
      it('should throw an error if the entity is not found with the id and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.addRelations(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
            },
          ),
        ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
      });

      it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.addRelations<TestRelation>(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              relationFilter: { relationName: { like: '%-one' } },
            },
          ),
        ).rejects.toThrow('Unable to find all testRelations to add to TestEntity');
      });
    });
  });

  describe('#setRelations', () => {
    it('set all relations on the entity', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const relationIds = TEST_RELATIONS.slice(3, 6).map((r) => r.id);
      const queryResult = await queryService.setRelations('testRelations', entity.id, relationIds);
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations.map((r: any) => r.id)).toEqual(relationIds);
    });

    it('should remove all relations if the relationIds is empty', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.setRelations('testRelations', entity.id, []);
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations.map((r: any) => r.id)).toEqual([]);
    });

    describe('with modify options', () => {
      it('should throw an error if the entity is not found with the id and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.setRelations(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
            },
          ),
        ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
      });

      it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.setRelations<TestRelation>(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              relationFilter: { relationName: { like: '%-one' } },
            },
          ),
        ).rejects.toThrow('Unable to find all testRelations to set on TestEntity');
      });
    });
  });

  describe('#setRelation', () => {
    it('call select and return the result', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.setRelation(
        'oneTestRelation',
        entity.id,
        TEST_RELATIONS[1].id,
      );
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relation = await queryService.findRelation(TestRelation, 'oneTestRelation', entity);
      const serializedRelation = relation;
      expect(serializedRelation?.id).toBe(TEST_RELATIONS[1].id);
    });

    describe('with modify options', () => {
      it('should throw an error if the entity is not found with the id and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.setRelation('oneTestRelation', entity.id, TEST_RELATIONS[1].id, {
            filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
          }),
        ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
      });

      it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.setRelation<TestRelation>(
            'oneTestRelation',
            entity.id,
            TEST_RELATIONS[1].id,
            {
              relationFilter: { relationName: { like: '%-one' } },
            },
          ),
        ).rejects.toThrow('Unable to find oneTestRelation to set on TestEntity');
      });
    });
  });

  describe('#removeRelations', () => {
    it('call select and return the result', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.removeRelations(
        'testRelations',
        entity.id,
        TEST_RELATIONS.slice(0, 3).map((r) => r.id),
      );
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations).toHaveLength(0);
    });

    it('should not remove any relations if relationIds is empty', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const queryResult = await queryService.removeRelations('testRelations', entity.id, []);
      const serialized = queryResult;
      expect(serialized).toMatchObject(entity);

      const relations = await queryService.queryRelations(
        TestRelation,
        'testRelations',
        entity,
        {},
      );
      const serializedRelations = relations;
      expect(serializedRelations).toHaveLength(3);
    });

    describe('with modify options', () => {
      it('should throw an error if the entity is not found with the id and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.removeRelations(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
            },
          ),
        ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
      });

      it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.removeRelations<TestRelation>(
            'testRelations',
            entity.id,
            TEST_RELATIONS.slice(3, 6).map((r) => r.id),
            {
              relationFilter: { relationName: { like: '%-one' } },
            },
          ),
        ).rejects.toThrow('Unable to find all testRelations to remove from TestEntity');
      });
    });
  });

  describe('#removeRelation', () => {
    describe('oneToOne', () => {
      it('set the relation to null', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.removeRelation(
          'oneTestRelation',
          entity.id,
          TEST_RELATIONS[0].id,
        );
        const serialized = queryResult;
        expect(serialized).toMatchObject(entity);

        const relation = await queryService.findRelation(TestRelation, 'oneTestRelation', entity);
        expect(relation).toBeUndefined();
      });

      describe('with modify options', () => {
        it('should throw an error if the entity is not found with the id and provided filter', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          return expect(
            queryService.removeRelation('oneTestRelation', entity.id, TEST_RELATIONS[1].id, {
              filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
            }),
          ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
        });

        it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          return expect(
            queryService.removeRelation<TestRelation>(
              'oneTestRelation',
              entity.id,
              TEST_RELATIONS[1].id,
              {
                relationFilter: { relationName: { like: '%-one' } },
              },
            ),
          ).rejects.toThrow('Unable to find oneTestRelation to remove from TestEntity');
        });
      });
    });

    describe('manyToOne', () => {
      it('set the relation to null', async () => {
        const relation = TEST_RELATIONS[0];
        const queryService = moduleRef.get(TestRelationService);
        const queryResult = await queryService.removeRelation(
          'testEntity',
          relation.id,
          TEST_ENTITIES[0].id,
        );
        const serialized = queryResult;
        // After removing the relation, testEntityId should be null
        expect(serialized).toMatchObject({ ...relation, testEntityId: null });

        const entity = await queryService.findRelation(TestEntity, 'testEntity', queryResult);
        expect(entity).toBeUndefined();
      });

      describe('with modify options', () => {
        it('should throw an error if the entity is not found with the id and provided filter', async () => {
          const relation = TEST_RELATIONS[0];
          const queryService = moduleRef.get(TestRelationService);
          return expect(
            queryService.removeRelation('testEntity', relation.id, TEST_ENTITIES[1].id, {
              filter: {
                relationName: { eq: TEST_RELATIONS[1].relationName },
              },
            }),
          ).rejects.toThrow('Unable to find TestRelation with id: test-relations-test-entity-1-1');
        });

        it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
          const relation = TEST_RELATIONS[0];
          const queryService = moduleRef.get(TestRelationService);
          return expect(
            queryService.removeRelation('testEntity', relation.id, TEST_ENTITIES[0].id, {
              relationFilter: {
                stringType: { eq: TEST_ENTITIES[1].stringType },
              },
            }),
          ).rejects.toThrow('Unable to find testEntity to remove from TestRelation');
        });
      });
    });

    describe('oneToMany', () => {
      it('set the relation to null', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const queryResult = await queryService.removeRelation(
          'testRelations',
          entity.id!,
          TEST_RELATIONS[0].id!,
        );
        expect(queryResult).toMatchObject(entity);

        const relations = await queryService.queryRelations(
          TestRelation,
          'testRelations',
          entity as TestEntity,
          {},
        );
        expect(relations).toHaveLength(2);
      });

      describe('with modify options', () => {
        it('should throw an error if the entity is not found with the id and provided filter', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          return expect(
            queryService.removeRelation('testRelations', entity.id, TEST_RELATIONS[4].id, {
              filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
            }),
          ).rejects.toThrow('Unable to find TestEntity with id: test-entity-1');
        });

        it('should throw an error if the relations are not found with the relationIds and provided filter', async () => {
          const entity = TEST_ENTITIES[0];
          const queryService = moduleRef.get(TestEntityService);
          return expect(
            queryService.removeRelation<TestRelation>(
              'testRelations',
              entity.id,
              TEST_RELATIONS[4].id,
              {
                relationFilter: { relationName: { like: '%-one' } },
              },
            ),
          ).rejects.toThrow('Unable to find testRelations to remove from TestEntity');
        });
      });
    });
  });

  describe('#findById', () => {
    it('return the entity if found', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const found = await queryService.findById(entity.id);
      expect(found).toMatchObject(entity);
    });

    it('return undefined if not found', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const found = await queryService.findById('bad-id');
      expect(found).toBeUndefined();
    });

    describe('with filter', () => {
      it('should return an entity if all filters match', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const found = await queryService.findById(entity.id, {
          filter: { stringType: { eq: entity.stringType } },
        });
        expect(found).toMatchObject(entity);
      });

      it('should return an undefined if an entitity with the pk and filter is not found', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const found = await queryService.findById(entity.id, {
          filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
        });
        expect(found).toBeUndefined();
      });
    });
  });

  describe('#getById', () => {
    it('return the entity if found', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const found = await queryService.getById(entity.id);
      expect(found).toMatchObject(entity);
    });

    it('should throw an error if not found', () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.getById('bad-id')).rejects.toThrow(
        'Unable to find TestEntity with id: bad-id',
      );
    });

    describe('with filter', () => {
      it('should return an entity if all filters match', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const found = await queryService.getById(entity.id, {
          filter: { stringType: { eq: entity.stringType } },
        });
        expect(found).toMatchObject(entity);
      });

      it('should return an undefined if an entitity with the pk and filter is not found', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.getById(entity.id, {
            filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
          }),
        ).rejects.toThrow(`Unable to find TestEntity with id: ${entity.id}`);
      });
    });
  });

  describe('#createMany', () => {
    it('call save on the repo with instances of entities when passed plain objects', async () => {
      await truncate(orm);
      const queryService = moduleRef.get(TestEntityService);
      const created = await queryService.createMany(TEST_ENTITIES);
      expect(created).toMatchObject(TEST_ENTITIES);
    });

    it('call save on the repo with instances of entities when passed instances', async () => {
      await truncate(orm);
      const instances = TEST_ENTITIES.map((e) => orm.em.create(TestEntity, e));
      const queryService = moduleRef.get(TestEntityService);
      const created = await queryService.createMany(instances);
      expect(created).toEqual(instances);
    });

    it('should reject if the entities already exist', async () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.createMany(TEST_ENTITIES)).rejects.toThrow(
        'Entity already exists',
      );
    });
  });

  describe('#createOne', () => {
    it('call save on the repo with an instance of the entity when passed a plain object', async () => {
      await truncate(orm);
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      const created = await queryService.createOne(entity);
      expect(created).toMatchObject(entity);
    });

    it('call save on the repo with an instance of the entity when passed an instance', async () => {
      await truncate(orm);
      const entity = orm.em.create(TestEntity, TEST_ENTITIES[0]);
      const queryService = moduleRef.get(TestEntityService);
      const created = await queryService.createOne(entity);
      expect(created).toMatchObject(entity);
    });

    it('should reject if the entity contains an id', async () => {
      const entity = TEST_ENTITIES[0];
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.createOne(entity)).rejects.toThrow('Entity already exists');
    });
  });

  describe('#deleteMany', () => {
    it('delete all records that match the query', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const { deletedCount } = await queryService.deleteMany({
        id: {
          in: TEST_ENTITIES.slice(0, 5).map((e) => e.id),
        },
      });
      expect(deletedCount).toEqual(expect.any(Number));
      const allCount = await queryService.count({});
      expect(allCount).toBe(5);
    });
  });

  describe('#deleteOne', () => {
    it('remove the entity', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const deleted = await queryService.deleteOne(TEST_ENTITIES[0].id);
      const serialized = deleted;
      // MikroORM's toJSON() filters out undefined values, so id won't be in the result
      const { id: _id, ...expectedWithoutPk } = TEST_ENTITIES[0];
      expect(serialized).toMatchObject(expectedWithoutPk);
    });

    it('call fail if the entity is not found', async () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.deleteOne('bad-id')).rejects.toThrow(
        'Unable to find TestEntity with id: bad-id',
      );
    });

    describe('with filter', () => {
      it('should delete the entity if all filters match', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const deleted = await queryService.deleteOne(entity.id, {
          filter: { stringType: { eq: entity.stringType } },
        });
        const serialized = deleted;
        // MikroORM's toJSON() filters out undefined values, so id won't be in the result
        const { id: _id, ...expectedWithoutPk } = TEST_ENTITIES[0];
        expect(serialized).toMatchObject(expectedWithoutPk);
      });

      it('should return throw an error if unable to find', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.deleteOne(entity.id, {
            filter: { stringType: { eq: TEST_ENTITIES[1].stringType } },
          }),
        ).rejects.toThrow(`Unable to find TestEntity with id: ${entity.id}`);
      });
    });
  });

  describe('#updateMany', () => {
    it('update all entities in the filter', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const filter = {
        id: {
          in: TEST_ENTITIES.slice(0, 5).map((e) => e.id),
        },
      };
      await queryService.updateMany({ stringType: 'updated' }, filter);
      const entities = await queryService.query({ filter });
      const serialized = entities;
      expect(serialized).toHaveLength(5);
      serialized.forEach((e: any) => expect(e.stringType).toBe('updated'));
    });

    it('should reject if the update contains a primary key', () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.updateMany({ id: 'updated' }, {})).rejects.toThrow(
        'Id cannot be specified when updating',
      );
    });
  });

  describe('#updateOne', () => {
    it('update the entity', async () => {
      const queryService = moduleRef.get(TestEntityService);
      const updated = await queryService.updateOne(TEST_ENTITIES[0].id, {
        stringType: 'updated',
      });
      const serialized = updated;
      expect(serialized).toMatchObject({
        ...TEST_ENTITIES[0],
        stringType: 'updated',
      });
    });

    it('should reject if the update contains a primary key', async () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(
        queryService.updateOne(TEST_ENTITIES[0].id, {
          id: 'bad-id',
        }),
      ).rejects.toThrow('Id cannot be specified when updating');
    });

    it('call fail if the entity is not found', async () => {
      const queryService = moduleRef.get(TestEntityService);
      return expect(queryService.updateOne('bad-id', { stringType: 'updated' })).rejects.toThrow(
        'Unable to find TestEntity with id: bad-id',
      );
    });

    describe('with filter', () => {
      it('should update the entity if all filters match', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        const updated = await queryService.updateOne(
          entity.id,
          { stringType: 'updated' },
          { filter: { stringType: { eq: entity.stringType } } },
        );
        const serialized = updated;
        expect(serialized).toMatchObject({ ...entity, stringType: 'updated' });
      });

      it('should throw an error if unable to find the entity', async () => {
        const entity = TEST_ENTITIES[0];
        const queryService = moduleRef.get(TestEntityService);
        return expect(
          queryService.updateOne(
            entity.id,
            { stringType: 'updated' },
            { filter: { stringType: { eq: TEST_ENTITIES[1].stringType } } },
          ),
        ).rejects.toThrow(`Unable to find TestEntity with id: ${entity.id}`);
      });
    });
  });

  describe('#isSoftDelete', () => {
    describe('#deleteMany', () => {
      it('should soft delete the entities matching the query', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        const entity = TEST_SOFT_DELETE_ENTITIES[0];
        const deleteMany: Filter<TestSoftDeleteEntity> = {
          id: { eq: entity.id },
        };
        await queryService.deleteMany(deleteMany);
        const foundEntity = await queryService.findById(entity.id);
        expect(foundEntity).toBeUndefined();
        const deletedEntity = await queryService.repo.findOne(entity.id, {
          filters: false,
        });
        expect(deletedEntity).toMatchObject({
          ...entity,
          deletedAt: expect.any(Date),
        });
      });
    });

    describe('#deleteOne', () => {
      it('should soft delete the entity', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        const entity = TEST_SOFT_DELETE_ENTITIES[0];
        const deleted = await queryService.deleteOne(entity.id);
        const serialized = deleted;
        // MikroORM returns entity with deletedAt set (unlike TypeORM which returns it unset)
        expect(serialized).toMatchObject({
          ...entity,
          deletedAt: expect.any(Date),
        });
        const foundEntity = await queryService.findById(entity.id);
        expect(foundEntity).toBeUndefined();
        const deletedEntity = await queryService.repo.findOne(entity.id, {
          filters: false,
        });
        const serializedDeleted = deletedEntity ? deletedEntity : deletedEntity;
        expect(serializedDeleted).toMatchObject({
          ...entity,
          deletedAt: expect.any(Date),
        });
      });

      it('should fail if the entity is not found', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        return expect(queryService.deleteOne('bad-id')).rejects.toThrow(
          'Unable to find TestSoftDeleteEntity with id: bad-id',
        );
      });
    });

    describe('#restoreOne', () => {
      it('restore the entity', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        const entity = TEST_SOFT_DELETE_ENTITIES[0];
        await queryService.deleteOne(entity.id);
        const restored = await queryService.restoreOne(entity.id);
        const serialized = restored;
        expect(serialized).toMatchObject({ ...entity, deletedAt: null });
        const foundEntity = await queryService.findById(entity.id);
        const serializedFound = foundEntity ? foundEntity : foundEntity;
        expect(serializedFound).toMatchObject({ ...entity, deletedAt: null });
      });

      it('should fail if the entity is not found', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        return expect(queryService.restoreOne('bad-id')).rejects.toThrow(
          'Unable to find TestSoftDeleteEntity with id: bad-id',
        );
      });

      it('should fail if the useSoftDelete is not enabled', async () => {
        const queryService = moduleRef.get(TestEntityService);
        return expect(queryService.restoreOne(TEST_ENTITIES[0].id)).rejects.toThrow(
          'Restore not allowed for non soft deleted entity TestEntity.',
        );
      });

      describe('with filter', () => {
        it('should restore the entity if all filters match', async () => {
          const queryService = moduleRef.get(TestSoftDeleteEntityService);
          const entity = TEST_SOFT_DELETE_ENTITIES[0];
          await queryService.deleteOne(entity.id);
          const restored = await queryService.restoreOne(entity.id, {
            filter: { stringType: { eq: entity.stringType } },
          });
          expect(restored).toMatchObject({ ...entity, deletedAt: null });
          const foundEntity = await queryService.findById(entity.id);
          expect(foundEntity).toMatchObject({ ...entity, deletedAt: null });
        });

        it('should return throw an error if unable to find', async () => {
          const queryService = moduleRef.get(TestSoftDeleteEntityService);
          const entity = TEST_SOFT_DELETE_ENTITIES[0];
          await queryService.deleteOne(entity.id);
          return expect(
            queryService.restoreOne(entity.id, {
              filter: {
                stringType: { eq: TEST_SOFT_DELETE_ENTITIES[1].stringType },
              },
            }),
          ).rejects.toThrow(`Unable to find TestSoftDeleteEntity with id: ${entity.id}`);
        });
      });
    });

    describe('#restoreMany', () => {
      it('should restore multiple entities', async () => {
        const queryService = moduleRef.get(TestSoftDeleteEntityService);
        const entity = TEST_SOFT_DELETE_ENTITIES[0];
        const filter: Filter<TestSoftDeleteEntity> = {
          id: { eq: entity.id },
        };
        await queryService.deleteMany(filter);
        await queryService.restoreMany(filter);
        const foundEntity = await queryService.findById(entity.id);
        expect(foundEntity).toMatchObject({ ...entity, deletedAt: null });
      });

      it('should fail if the useSoftDelete is not enabled', async () => {
        const queryService = moduleRef.get(TestEntityService);
        return expect(queryService.restoreMany({ stringType: { eq: 'foo' } })).rejects.toThrow(
          'Restore not allowed for non soft deleted entity TestEntity.',
        );
      });
    });
  });
});
