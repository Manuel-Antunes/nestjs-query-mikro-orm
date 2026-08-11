import { MikroORM } from '@mikro-orm/core';
import { defineConfig as defineSqliteConfig, SqliteDriver } from '@mikro-orm/sqlite';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { defineConfig as defineMongoConfig } from '@mikro-orm/mongodb';

import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { seed } from './seeds';
import { TestEntityRelationEntity } from './test-entity-relation.entity';
import { TestRelation } from './test-relation.entity';
import { TestSoftDeleteEntity } from './test-soft-delete.entity';
import { TestEntity } from './test.entity';

const ENTITIES = [
  TestEntity,
  TestSoftDeleteEntity,
  TestRelation,
  TestEntityRelationEntity,
  RelationOfTestRelationEntity,
];

export const CONNECTION_OPTIONS = defineSqliteConfig({
  driver: SqliteDriver,
  dbName: ':memory:',
  entities: ENTITIES,
  allowGlobalContext: true,
  debug: false,
});

let orm: MikroORM;
let mongod: MongoMemoryServer | undefined;

export async function createTestConnection(): Promise<MikroORM> {
  const driver = process.env.TEST_DRIVER ?? 'sqlite';

  if (driver === 'mongo') {
    mongod = await MongoMemoryServer.create();
    orm = await MikroORM.init(
      defineMongoConfig({
        clientUrl: mongod.getUri(),
        dbName: 'test',
        entities: ENTITIES,
        allowGlobalContext: true,
        debug: false,
      }),
    );
    return orm;
  }

  orm = await MikroORM.init(CONNECTION_OPTIONS);
  await orm.schema.create();
  return orm;
}

export async function closeTestConnection(): Promise<void> {
  if (orm) {
    await orm.close(true);
    orm = undefined as unknown as MikroORM;
  }
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

export function getTestConnection(): MikroORM {
  return orm;
}

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
