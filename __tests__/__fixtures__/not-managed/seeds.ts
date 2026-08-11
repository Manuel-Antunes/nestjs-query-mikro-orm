import { ref, wrap, type MikroORM } from '@mikro-orm/core';

import { getTestConnection } from './connection.fixture';
import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { AddressEmbedded } from './address.embedded';
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
  'id' | 'stringType' | 'boolType' | 'numberType' | 'dateType'
>;

export type TestSoftDeleteEntitySeed = Pick<TestSoftDeleteEntity, 'id' | 'stringType'>;

export type TestRelationSeed = Pick<TestRelation, 'id' | 'relationName' | 'testEntityId'>;

/** The relation is seeded as a bare key and swapped for a reference by the seeder. */
export type RelationOfTestRelationSeed = Pick<
  RelationOfTestRelationEntity,
  'id' | 'relationName'
> & {
  testRelation: { id: string };
};

/**
 * The seeded rows, typed as the entities they stand in for.
 *
 * Every seeded column is always present, so `Partial<Entity>` would only push `| undefined` into
 * every test that reads one. The collections and back-references stay absent until the seeder
 * wires them up, which is why this is a cast at the definition instead of a construction: the APIs
 * under test take entities and only ever read the seeded columns.
 */
export const TEST_ENTITIES: TestEntity[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
  const id = `test-entity-${i}`;
  return {
    id,
    boolType: i % 2 === 0,
    dateType: new Date(`2020-02-${i}`),
    numberType: i,
    stringType: `foo${i}`,
  };
}) as unknown as TestEntity[];

export const TEST_ENTITY_ADDRESSES: Record<string, AddressEmbedded> = {
  'test-entity-1': new AddressEmbedded({
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zipCode: '62701',
  }),
  'test-entity-2': new AddressEmbedded({
    street: '55 Elm St',
    city: 'Shelbyville',
    state: 'IL',
    zipCode: '62565',
  }),
};

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
  const id = `test-entity-${i}`;
  return {
    id,
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
    testRelation: { id: testRelation.id },
  }),
) as unknown as RelationOfTestRelationEntity[];

export const seed = async (orm: MikroORM = getTestConnection()): Promise<void> => {
  const em = orm.em.fork();

  // Create test entities
  const testEntities: TestEntity[] = [];
  for (const entityData of TEST_ENTITIES) {
    const entity = em.create(TestEntity, entityData as TestEntity);
    const address = TEST_ENTITY_ADDRESSES[entityData.id];
    if (address) {
      entity.address = address;
    }
    testEntities.push(entity);
  }
  await em.persist(testEntities).flush();

  // Create test relations and link to entities
  const testRelations: TestRelation[] = [];
  for (const relationData of TEST_RELATIONS) {
    const relation = em.create(TestRelation, relationData as TestRelation);
    const testEntity = testEntities.find((te) => te.id === relationData.testEntityId);
    if (testEntity) {
      // both sides are declared as references on the schema, so they take a ref, not the entity
      relation.testEntity = ref(testEntity);
      relation.testEntityUniDirectional = ref(testEntity);
    }
    testRelations.push(relation);
  }
  await em.persist(testRelations).flush();

  // Create relations of test relation and link to test relations
  const relationsOfRelation: RelationOfTestRelationEntity[] = [];
  for (const rorData of TEST_RELATIONS_OF_RELATION) {
    const ror = em.create(RelationOfTestRelationEntity, {
      ...rorData,
      testRelation: em.getReference(TestRelation, rorData.testRelation!.id),
    } as unknown as RelationOfTestRelationEntity);

    relationsOfRelation.push(ror);
  }
  await em.persist(relationsOfRelation).flush();

  // Set up relationships
  for (const [index, te] of testEntities.entries()) {
    const oneRelation = testRelations[index * 3];
    if (oneRelation) {
      wrap(te).assign({ oneTestRelation: ref(oneRelation) } as Partial<TestEntity>);
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
