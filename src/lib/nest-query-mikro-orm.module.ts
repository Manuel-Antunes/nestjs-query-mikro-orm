import type { AnyEntity, EntityName } from '@mikro-orm/core';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import type { EntityServiceDefinition, EntityServiceDefinitions } from './providers';
import { createMikroOrmQueryServiceProviders, getDefinitionEntity } from './providers';

export class NestjsQueryMikroOrmModule {
  /**
   * @param entities - the entities to expose a query service for. Each one is either the entity
   * itself, or `{ entity, dto?, assembler? }` when the service should exchange DTOs instead - see
   * {@link EntityServiceDefinition}.
   */
  static forFeature<const Defs extends readonly unknown[]>(
    entities: EntityServiceDefinitions<Defs>,
    contextName?: string,
  ): DynamicModule {
    const queryServiceProviders = createMikroOrmQueryServiceProviders(entities, contextName);
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
