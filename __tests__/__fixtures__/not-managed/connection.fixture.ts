import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  EntityData,
  EntityFactory,
  EntityName,
  EntityProperty,
  Hydrator,
  MikroORM,
  Primary,
  Reference,
  ref,
} from '@mikro-orm/core';
import { defineConfig as defineMongoConfig } from '@mikro-orm/mongodb';
import { defineConfig as defineSqliteConfig, SqliteDriver } from '@mikro-orm/sqlite';

import {
  RelationOfTestRelationEntity,
  RelationOfTestRelationSchema,
} from './relation-of-test-relation.entity';
import { seed } from './seeds';
import { TestEntityRelationEntity, TestEntityRelationSchema } from './test-entity-relation.entity';
import { TestRelation, TestRelationSchema } from './test-relation.entity';
import { TestSoftDeleteEntity, TestSoftDeleteSchema } from './test-soft-delete.entity';
import { TestEntity, TestSchema } from './test.entity';

export const CONNECTION_OPTIONS = defineSqliteConfig({
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
});

/** The schemas are what the not-managed suite actually discovers, unlike CONNECTION_OPTIONS. */
const SCHEMAS = [
  TestSchema,
  TestSoftDeleteSchema,
  TestRelationSchema,
  TestEntityRelationSchema,
  RelationOfTestRelationSchema,
];

let orm: MikroORM;
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
    // the not-managed entities keep their state under a `props` bag the schema does not declare,
    // plus `_`-prefixed backing fields behind their getters - neither is visible on the entity type
    const entityRef = entity as unknown as Record<string, unknown> & {
      props: Record<string, unknown>;
    };
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
      const proto = Reference.prototype as unknown as Record<string, unknown>;
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
    // the hydrated value passes through several shapes here (raw column, embeddable, reference)
    let val: unknown = rawValue;

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
        (prop as unknown as { embeddable?: new (data: Record<string, unknown>) => unknown })
          .embeddable ?? prop.type;
      if (typeof embeddableCtor === 'function') {
        val = new embeddableCtor(embeddedData);
      } else {
        val = factory.createEmbeddable(
          embeddableCtor as unknown as EntityName<object>,
          embeddedData as EntityData<object>,
          { newEntity, convertCustomTypes },
        );
      }
    } else if (rawValue === undefined) {
      return;
    }
    if (val !== null && val !== undefined) {
      if (prop.kind === 'm:1' || prop.kind === '1:1') {
        // the target is only known by class name at this point, which the factory resolves
        const targetType = (prop.targetMeta?.className ||
          prop.type) as unknown as EntityName<object>;
        const candidate = val as { __entity?: unknown; id?: unknown; _id?: unknown };
        if (!candidate.__entity && typeof val !== 'object') {
          val = factory.createReference(targetType, val as Primary<object>, {
            merge: true,
            convertCustomTypes,
          });
        } else if (
          typeof val === 'object' &&
          !candidate.__entity &&
          (candidate.id || candidate._id)
        ) {
          val = factory.createReference(
            targetType,
            (candidate.id ?? candidate._id) as Primary<object>,
            {
              merge: true,
              convertCustomTypes,
            },
          );
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

export async function createTestConnection(): Promise<MikroORM> {
  const driver = process.env.TEST_DRIVER ?? 'sqlite';

  if (driver === 'mongo') {
    mongod = await MongoMemoryServer.create();
    orm = await MikroORM.init(
      defineMongoConfig({
        hydrator: CustomHydrator,
        propagationOnPrototype: false,
        clientUrl: mongod.getUri(),
        entities: SCHEMAS,
        allowGlobalContext: true,
        debug: false,
      }),
    );
    return orm;
  }

  orm = await MikroORM.init(
    defineSqliteConfig({
      hydrator: CustomHydrator,
      driver: SqliteDriver,
      dbName: ':memory:',
      propagationOnPrototype: false,
      entities: SCHEMAS,
      allowGlobalContext: true,
      debug: false,
    }),
  );
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
