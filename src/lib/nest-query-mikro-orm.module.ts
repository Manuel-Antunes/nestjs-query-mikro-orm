import type { AnyEntity, EntityName } from '@mikro-orm/core';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import type {
  EntityServiceDefinition,
  EntityServiceDefinitions,
  ForFeatureOptions,
} from './providers';
import {
  createMikroOrmQueryServiceProviders,
  getDefinitionEntity,
  toForFeatureOptions,
} from './providers';

export class NestjsQueryMikroOrmModule {
  /**
   * Registers a query service for each entity.
   *
   * @param entities - what to expose a query service for. Each entry is either the entity itself,
   * or `{ entity, dto?, assembler?, ...serviceOptions }` - see {@link EntityServiceDefinition}.
   *
   * @param contextNameOrOptions - the MikroORM context name, or an options object carrying it
   * alongside the service options every registered service should share.
   *
   * @example
   * ```ts
   * NestjsQueryMikroOrmModule.forFeature(
   *   [UserEntity, OrderEntity, { entity: AuditEntity, useSoftDelete: true }],
   *   { aggregateStrategy: new SqlAggregateStrategy() },
   * )
   * ```
   * The strategy reaches all three services; only `AuditEntity` soft deletes. An entry's own
   * options win over the shared ones.
   */
  static forFeature<const Defs extends readonly unknown[]>(
    entities: EntityServiceDefinitions<Defs>,
    contextNameOrOptions?: string | ForFeatureOptions,
  ): DynamicModule {
    const { contextName } = toForFeatureOptions(contextNameOrOptions);

    const queryServiceProviders = createMikroOrmQueryServiceProviders(
      entities,
      contextNameOrOptions,
    );
    const entityNames: EntityName<AnyEntity>[] = (
      entities as readonly EntityServiceDefinition[]
    ).map(getDefinitionEntity);
    const mikroOrmModule = MikroOrmModule.forFeature(entityNames, contextName);

    return {
      imports: [mikroOrmModule],
      module: NestjsQueryMikroOrmModule,
      providers: [...queryServiceProviders],
      exports: [...queryServiceProviders, mikroOrmModule],
    };
  }
}
