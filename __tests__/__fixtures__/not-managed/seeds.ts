import { ref, wrap, type MikroORM } from '@mikro-orm/core';

import { getTestConnection } from './connection.fixture';
import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { TestEntity } from './test.entity';

export const TEST_ENTITIES: Partial<TestEntity>[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
  const id = `test-entity-${i}`;
  return {
    id,
    boolType: i % 2 === 0,
    dateType: new Date(`2020-02-${i}`),
    numberType: i,
    stringType: `foo${i}`,
  };
});

export const TEST_SOFT_DELETE_ENTITIES: Partial<TestSoftDeleteEntity>[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
].map((i) => {
  const id = `test-entity-${i}`;
  return {
    id,
    stringType: `foo${i}`,
  };
});

export const TEST_RELATIONS: Partial<TestRelation>[] = (TEST_ENTITIES as TestEntity[]).reduce(
  (relations, te) => [
    ...relations,
    {
      id: `test-relations-${te.id}-1`,
      relationName: `${te.stringType}-test-relation-one`,
      testEntityId: te.id,
    },
    {
      id: `test-relations-${te.id}-2`,
      relationName: `${te.stringType}-test-relation-two`,
      testEntityId: te.id,
    },
    {
      id: `test-relations-${te.id}-3`,
      relationName: `${te.stringType}-test-relation-three`,
      testEntityId: te.id,
    },
  ],
  [] as Partial<TestRelation>[],
);

export const TEST_RELATIONS_OF_RELATION = (TEST_RELATIONS as TestRelation[]).map<
  Partial<RelationOfTestRelationEntity>
>((testRelation) => ({
  relationName: `test-relation-of-${testRelation.relationName}`,
  id: `relation-of-test-relation-${testRelation.relationName}`,
  testRelation: { id: testRelation.id },
})) as Partial<RelationOfTestRelationEntity>[];

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
    const testEntity = testEntities.find((te) => te.id === relationData.testEntityId);
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
    const data = { ...rorData };
    if (data.testRelation) {
      data.testRelation = em.getReference(TestRelation, (data.testRelation as any).id);
    }
    const ror = em.create(RelationOfTestRelationEntity, data as RelationOfTestRelationEntity);

    relationsOfRelation.push(ror);
  }
  await em.persist(relationsOfRelation).flush();

  // Set up relationships
  for (const [index, te] of testEntities.entries()) {
    const oneRelation = testRelations[index * 3];
    if (oneRelation) {
      wrap(te).assign({ oneTestRelation: oneRelation } as Partial<TestEntity>);
      await em.nativeUpdate(TestEntity, { id: te.id }, {
        oneTestRelation: oneRelation.id,
      } as unknown as Partial<TestEntity>);
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
    const ror = relationsOfRelation.find((r) => r.testRelation?.id === tr.id);
    if (ror) {
      wrap(tr).assign({ relationOfTestRelation: ref(ror) } as Partial<TestRelation>);
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
