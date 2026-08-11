import type { MikroORM } from '@mikro-orm/core';

import { getTestConnection } from './connection.fixture';
import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { TestEntity } from './test.entity';

/**
 * The columns a seed row carries.
 *
 * `Partial<Entity>` would be the loose way to spell this, but it makes every seeded column
 * `| undefined` at the point of use, which pushes non-null assertions into every test that reads
 * one. Picking the columns keeps them required while still leaving out the collections and
 * relation references the seeder wires up afterwards.
 */
export type TestEntitySeed = Pick<
  TestEntity,
  'testEntityPk' | 'stringType' | 'boolType' | 'numberType' | 'dateType'
>;

export type TestSoftDeleteEntitySeed = Pick<TestSoftDeleteEntity, 'testEntityPk' | 'stringType'>;

export type TestRelationSeed = Pick<
  TestRelation,
  'testRelationPk' | 'relationName' | 'testEntityId' | 'uniDirectionalTestEntityId'
>;

export type RelationOfTestRelationSeed = Pick<
  RelationOfTestRelationEntity,
  'id' | 'relationName' | 'testRelationId'
>;

/**
 * The seeded rows, typed as the entities they stand in for.
 *
 * Every seeded column is always present, so `Partial<Entity>` would only push `| undefined` into
 * every test that reads one. The collections and back-references stay absent until the seeder
 * wires them up, which is why this is a cast at the definition instead of a construction: the APIs
 * under test take entities and only ever read the seeded columns.
 */
export const TEST_ENTITIES: TestEntity[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
  const testEntityPk = `test-entity-${i}`;
  return {
    testEntityPk,
    boolType: i % 2 === 0,
    dateType: new Date(`2020-02-${i}`),
    numberType: i,
    stringType: `foo${i}`,
  };
}) as unknown as TestEntity[];

/**
 * The seeded rows, typed as the entities they stand in for.
 *
 * Every seeded column is always present, so `Partial<Entity>` would only push `| undefined` into
 * every test that reads one. The collections and back-references stay absent until the seeder
 * wires them up, which is why this is a cast at the definition instead of a construction: the APIs
 * under test take entities and only ever read the seeded columns.
 */
export const TEST_SOFT_DELETE_ENTITIES: TestSoftDeleteEntity[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
].map((i) => {
  const testEntityPk = `test-entity-${i}`;
  return {
    testEntityPk,
    stringType: `foo${i}`,
  };
}) as unknown as TestSoftDeleteEntity[];

/**
 * The seeded rows, typed as the entities they stand in for.
 *
 * Every seeded column is always present, so `Partial<Entity>` would only push `| undefined` into
 * every test that reads one. The collections and back-references stay absent until the seeder
 * wires them up, which is why this is a cast at the definition instead of a construction: the APIs
 * under test take entities and only ever read the seeded columns.
 */
export const TEST_RELATIONS: TestRelation[] = TEST_ENTITIES.reduce(
  (relations, te) => [
    ...relations,
    {
      testRelationPk: `test-relations-${te.testEntityPk}-1`,
      relationName: `${te.stringType}-test-relation-one`,
      testEntityId: te.testEntityPk,
      uniDirectionalTestEntityId: te.testEntityPk,
    },
    {
      testRelationPk: `test-relations-${te.testEntityPk}-2`,
      relationName: `${te.stringType}-test-relation-two`,
      testEntityId: te.testEntityPk,
      uniDirectionalTestEntityId: te.testEntityPk,
    },
    {
      testRelationPk: `test-relations-${te.testEntityPk}-3`,
      relationName: `${te.stringType}-test-relation-three`,
      testEntityId: te.testEntityPk,
      uniDirectionalTestEntityId: te.testEntityPk,
    },
  ],
  [] as TestRelationSeed[],
) as unknown as TestRelation[];

/**
 * The seeded rows, typed as the entities they stand in for.
 *
 * Every seeded column is always present, so `Partial<Entity>` would only push `| undefined` into
 * every test that reads one. The collections and back-references stay absent until the seeder
 * wires them up, which is why this is a cast at the definition instead of a construction: the APIs
 * under test take entities and only ever read the seeded columns.
 */
export const TEST_RELATIONS_OF_RELATION: RelationOfTestRelationEntity[] = TEST_RELATIONS.map(
  (testRelation) => ({
    relationName: `test-relation-of-${testRelation.relationName}`,
    id: `relation-of-test-relation-${testRelation.relationName}`,
    testRelationId: testRelation.testRelationPk,
  }),
) as unknown as RelationOfTestRelationEntity[];

export const seed = async (orm: MikroORM = getTestConnection()): Promise<void> => {
  const em = orm.em.fork();

  // Create test entities
  const testEntities: TestEntity[] = [];
  for (const entityData of TEST_ENTITIES) {
    const entity = em.create(TestEntity, entityData as TestEntity);
    testEntities.push(entity);
  }
  await em.persist(testEntities).flush();

  // Create test relations and link to entities
  const testRelations: TestRelation[] = [];
  for (const relationData of TEST_RELATIONS) {
    const relation = em.create(TestRelation, relationData as TestRelation);
    // Link the ManyToOne relations to actual entity references
    const testEntity = testEntities.find((te) => te.testEntityPk === relationData.testEntityId);
    if (testEntity) {
      relation.testEntity = testEntity;
      relation.testEntityUniDirectional = testEntity;
    }
    testRelations.push(relation);
  }
  await em.persist(testRelations).flush();

  // Create relations of test relation and link to test relations
  const relationsOfRelation: RelationOfTestRelationEntity[] = [];
  for (const rorData of TEST_RELATIONS_OF_RELATION) {
    const ror = em.create(RelationOfTestRelationEntity, rorData as RelationOfTestRelationEntity);
    // Link the ManyToOne relation to actual testRelation reference
    const testRelation = testRelations.find((tr) => tr.testRelationPk === rorData.testRelationId);
    if (testRelation) {
      ror.testRelation = testRelation;
    }
    relationsOfRelation.push(ror);
  }
  await em.persist(relationsOfRelation).flush();

  // Set up relationships
  for (const te of testEntities) {
    const oneRelation = testRelations.find(
      (tr) => tr.testRelationPk === `test-relations-${te.testEntityPk}-1`,
    );
    if (oneRelation) {
      te.oneTestRelation = oneRelation;
    }
    if (te.numberType % 2 === 0) {
      const twoRelations = testRelations.filter((tr) => tr.relationName.endsWith('two'));
      te.manyTestRelations.set(twoRelations);
    }
    if (te.numberType % 3 === 0) {
      const threeRelations = testRelations.filter((tr) => tr.relationName.endsWith('three'));
      te.manyToManyUniDirectional.set(threeRelations);
    }
  }
  await em.flush();

  // Update relation references - link the ManyToOne relation from TestRelation to RelationOfTestRelation
  for (const tr of testRelations) {
    const ror = relationsOfRelation.find((r) => r.testRelationId === tr.testRelationPk);
    if (ror) {
      tr.relationOfTestRelationId = ror.id;
      tr.relationOfTestRelation = ror;
    }
  }
  await em.flush();

  // Create soft delete entities
  const softDeleteEntities: TestSoftDeleteEntity[] = [];
  for (const entityData of TEST_SOFT_DELETE_ENTITIES) {
    const entity = em.create(TestSoftDeleteEntity, entityData as TestSoftDeleteEntity);
    softDeleteEntities.push(entity);
  }
  await em.persist(softDeleteEntities).flush();
};
