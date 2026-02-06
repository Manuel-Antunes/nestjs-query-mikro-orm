import type { MikroORM } from '@mikro-orm/core';

import { getTestConnection } from './connection.fixture';
import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { TestEntity } from './test.entity';

export const TEST_ENTITIES: Partial<TestEntity>[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
  const testEntityPk = `test-entity-${i}`;
  return {
    testEntityPk,
    boolType: i % 2 === 0,
    dateType: new Date(`2020-02-${i}`),
    numberType: i,
    stringType: `foo${i}`,
  };
});

export const TEST_SOFT_DELETE_ENTITIES: Partial<TestSoftDeleteEntity>[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
].map((i) => {
  const testEntityPk = `test-entity-${i}`;
  return {
    testEntityPk,
    stringType: `foo${i}`,
  };
});

export const TEST_RELATIONS: Partial<TestRelation>[] = (TEST_ENTITIES as TestEntity[]).reduce(
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
  [] as Partial<TestRelation>[],
);

export const TEST_RELATIONS_OF_RELATION = (TEST_RELATIONS as TestRelation[]).map<
  Partial<RelationOfTestRelationEntity>
>((testRelation) => ({
  relationName: `test-relation-of-${testRelation.relationName}`,
  id: `relation-of-test-relation-${testRelation.relationName}`,
  testRelationId: testRelation.testRelationPk,
})) as Partial<RelationOfTestRelationEntity>[];

export const seed = async (orm: MikroORM = getTestConnection()): Promise<void> => {
  const em = orm.em.fork();

  // Create test entities
  const testEntities: TestEntity[] = [];
  for (const entityData of TEST_ENTITIES) {
    const entity = em.create(TestEntity, entityData as TestEntity);
    testEntities.push(entity);
  }
  await em.persistAndFlush(testEntities);

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
  await em.persistAndFlush(testRelations);

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
  await em.persistAndFlush(relationsOfRelation);

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
  await em.persistAndFlush(softDeleteEntities);
};
