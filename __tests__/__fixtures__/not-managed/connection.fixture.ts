import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  EntityData,
  EntityFactory,
  EntityProperty,
  Hydrator,
  MikroORM,
  Options,
  Reference,
  ref,
} from '@mikro-orm/core';
import { MongoDriver } from '@mikro-orm/mongodb';
import { SqliteDriver } from '@mikro-orm/sqlite';

import {
  RelationOfTestRelationEntity,
  RelationOfTestRelationSchema,
} from './relation-of-test-relation.entity';
import { seed } from './seeds';
import { TestEntityRelationEntity, TestEntityRelationSchema } from './test-entity-relation.entity';
import { TestRelation, TestRelationSchema } from './test-relation.entity';
import { TestSoftDeleteEntity, TestSoftDeleteSchema } from './test-soft-delete.entity';
import { TestEntity, TestSchema } from './test.entity';

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
  debug: true,
};

let orm: MikroORM<any>;
let mongod: MongoMemoryServer | undefined;

export class CustomHydrator extends Hydrator {
  private static scalarRefIdPatched = false;
  private static referenceIdPatched = false;

  private ensureEnumerableGetters(entityRef: Record<string, unknown>): void {
    if (entityRef.__hydratorGettersDefined) {
      return;
    }

    const proto = Object.getPrototypeOf(entityRef);
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === 'constructor') {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(entityRef, key)) {
        continue;
      }

      if (!descriptor.get && !descriptor.set) {
        continue;
      }

      Object.defineProperty(entityRef, key, {
        get: descriptor.get?.bind(entityRef),
        set: descriptor.set?.bind(entityRef),
        enumerable: true,
        configurable: true,
      });
    }

    Object.defineProperty(entityRef, '__hydratorGettersDefined', {
      value: true,
      enumerable: false,
    });
  }

  protected override hydrateProperty<T extends object>(
    entity: T,
    prop: EntityProperty<T>,
    data: EntityData<T>,
    factory: EntityFactory,
    newEntity?: boolean,
    convertCustomTypes?: boolean,
  ): void {
    const entityRef = entity as any;
    if (!entityRef.props) {
      entityRef.props = {};
    }

    if (!CustomHydrator.scalarRefIdPatched) {
      const scalarRef = ref('__scalar_ref__');
      const proto = Object.getPrototypeOf(scalarRef);
      if (proto && !Object.getOwnPropertyDescriptor(proto, 'id')) {
        Object.defineProperty(proto, 'id', {
          get() {
            const value = (this as { value?: unknown }).value;
            if (value && typeof value === 'object') {
              if ('id' in (value as Record<string, unknown>)) {
                const idValue = (value as Record<string, unknown>).id;
                if (idValue !== undefined) {
                  return idValue;
                }
              }
              if ('value' in (value as Record<string, unknown>)) {
                return (value as Record<string, unknown>).value;
              }
            }
            return value;
          },
          enumerable: true,
          configurable: true,
        });
      }
      CustomHydrator.scalarRefIdPatched = true;
    }

    if (!CustomHydrator.referenceIdPatched) {
      const proto = Reference.prototype as Record<string, unknown>;
      if (!Object.getOwnPropertyDescriptor(proto, 'id')) {
        Object.defineProperty(proto, 'id', {
          get() {
            const helper = (this as { __helper?: { getPrimaryKey: () => unknown } }).__helper;
            if (helper?.getPrimaryKey) {
              const pk = helper.getPrimaryKey();
              if (pk !== undefined) {
                return pk;
              }
            }
            const entity = (this as { entity?: { id?: unknown } }).entity;
            if (entity?.id !== undefined) {
              return entity.id;
            }
            const value = (this as { value?: unknown }).value;
            return value;
          },
          enumerable: true,
          configurable: true,
        });
      }
      CustomHydrator.referenceIdPatched = true;
    }

    this.ensureEnumerableGetters(entityRef);

    const rawValue = data[prop.name as keyof EntityData<T>];
    const embeddedProps = (prop as { embeddedProps?: Record<string, EntityProperty<T>> })
      .embeddedProps;
    let val = rawValue as any;

    if (rawValue === undefined && embeddedProps) {
      const embeddedData: Record<string, unknown> = {};
      let hasValue = false;
      for (const childProp of Object.values(embeddedProps)) {
        const childValue = (data as Record<string, unknown>)[childProp.name as string];
        if (childValue !== undefined && childValue !== null) {
          hasValue = true;
        }
        const embeddedKey = childProp.embedded?.[1] ?? childProp.name;
        embeddedData[embeddedKey] = childValue;
      }

      if (!hasValue) {
        return;
      }
      const embeddableCtor =
        (prop as { embeddable?: new (...args: any[]) => unknown; type?: any }).embeddable ??
        prop.type;
      if (typeof embeddableCtor === 'function') {
        val = new embeddableCtor(embeddedData);
      } else {
        val = factory.createEmbeddable(embeddableCtor, embeddedData as EntityData<object>, {
          newEntity,
          convertCustomTypes,
        });
      }
    } else if (rawValue === undefined) {
      return;
    }
    if (val !== null && val !== undefined) {
      if (prop.kind === 'm:1' || prop.kind === '1:1') {
        const targetType = prop.targetMeta?.className || prop.type;
        if (!val.__entity && typeof val !== 'object') {
          val = factory.createReference(targetType, val, { merge: true, convertCustomTypes });
        } else if (typeof val === 'object' && !val.__entity && (val.id || val._id)) {
          val = factory.createReference(targetType, val.id || val._id, {
            merge: true,
            convertCustomTypes,
          });
        }
      }
    }

    try {
      super.hydrateProperty(
        entity,
        prop,
        { ...data, [prop.name]: val },
        factory,
        newEntity,
        convertCustomTypes,
      );
    } catch {
      // Getter-only properties on not-managed entities can fail assignment in default hydrator.
      entityRef.props[prop.name] = val;
      try {
        entityRef[`_${String(prop.name)}`] = val;
      } catch {
        // No-op: some properties intentionally do not have backing fields.
      }
      return;
    }

    // Mirror hydrated values into props so getter-based domain entities stay consistent.
    entityRef.props[prop.name] = val;

    if (`_${String(prop.name)}` in entityRef) {
      try {
        entityRef[`_${String(prop.name)}`] = val;
      } catch {
        // Ignore assignment issues for readonly backing fields.
      }
    }
  }
}

export async function createTestConnection(): Promise<MikroORM<any>> {
  const driver = process.env.TEST_DRIVER ?? 'sqlite';

  if (driver === 'mongo') {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    const opts: Options<MongoDriver> = {
      hydrator: CustomHydrator,
      driver: MongoDriver,
      propagationOnPrototype: false,
      clientUrl: uri,
      entities: [
        TestSchema,
        TestSoftDeleteSchema,
        TestRelationSchema,
        TestEntityRelationSchema,
        RelationOfTestRelationSchema,
      ],
      allowGlobalContext: true,
      debug: false,
    } as Options<MongoDriver>;
    orm = await MikroORM.init(opts as any);
    return orm;
  }

  const CONNECTION_OPTIONS: Options<SqliteDriver> = {
    hydrator: CustomHydrator,
    driver: SqliteDriver,
    dbName: ':memory:',
    propagationOnPrototype: false,
    entities: [
      TestSchema,
      TestSoftDeleteSchema,
      TestRelationSchema,
      TestEntityRelationSchema,
      RelationOfTestRelationSchema,
    ],
    allowGlobalContext: true,
    debug: false,
  };

  orm = await MikroORM.init(CONNECTION_OPTIONS as any);
  await orm.schema.createSchema();
  return orm;
}

export async function closeTestConnection(): Promise<void> {
  if (orm) {
    await orm.close(true);
    orm = undefined as unknown as MikroORM<any>;
  }
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

export function getTestConnection(): MikroORM<any> {
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

  await em.nativeDelete(TestEntityRelationEntity, {});
  await em.nativeDelete(RelationOfTestRelationEntity, {});
  await em.nativeDelete(TestRelation, {});
  await em.nativeDelete(TestSoftDeleteEntity, {});
  await em.nativeDelete(TestEntity, {});

  connection.em.clear();
  connection.em.clear();
  connection.config.getResultCacheAdapter()?.clear();
  em.clear();
};

export const refresh = async (connection: MikroORM = orm): Promise<void> => {
  await truncate(connection);
  return seed(connection);
};
