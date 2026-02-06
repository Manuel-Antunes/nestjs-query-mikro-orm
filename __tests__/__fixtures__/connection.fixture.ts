import type { Options } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';

import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { seed } from './seeds';
import { TestEntityRelationEntity } from './test-entity-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { TestEntity } from './test.entity';

export const CONNECTION_OPTIONS: Options<SqliteDriver> = {
  driver: SqliteDriver,
  dbName: ':memory:',
  entities: [
    TestEntity,
    TestSoftDeleteEntity,
    TestRelation,
    TestEntityRelationEntity,
    RelationOfTestRelationEntity,
  ],
  allowGlobalContext: true,
  debug: false,
};

let orm: MikroORM<SqliteDriver>;

export async function createTestConnection(): Promise<MikroORM<SqliteDriver>> {
  orm = await MikroORM.init(CONNECTION_OPTIONS);
  await orm.schema.createSchema();
  return orm;
}

export async function closeTestConnection(): Promise<void> {
  if (orm) {
    await orm.close(true);
  }
}

export function getTestConnection(): MikroORM<SqliteDriver> {
  return orm;
}

const _tables = [
  'test_entity',
  'relation_of_test_relation_entity',
  'test_relation',
  'test_entity_relation_entity',
  'test_soft_delete_entity',
  'test_entity_many_test_relations',
];

export const truncate = async (connection: MikroORM = orm): Promise<void> => {
  const em = connection.em.fork();

  // Delete all entities using ORM methods in reverse order to respect FKs
  await em.nativeDelete(TestEntityRelationEntity, {});
  await em.nativeDelete(RelationOfTestRelationEntity, {});
  await em.nativeDelete(TestRelation, {});
  await em.nativeDelete(TestSoftDeleteEntity, {});
  await em.nativeDelete(TestEntity, {});

  // Clear all identity maps
  connection.em.clear();
  // Clear all entity managers and query result cache
  connection.em.clear();
  connection.config.getResultCacheAdapter()?.clear();
  em.clear();
};

export const refresh = async (connection: MikroORM = orm): Promise<void> => {
  await truncate(connection);
  return seed(connection);
};
