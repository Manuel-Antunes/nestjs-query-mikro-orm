import type { AnyEntity, EntityName } from '@mikro-orm/core';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { createMikroOrmQueryServiceProviders } from './providers';

export class NestjsQueryMikroOrmModule {
  static forFeature(
    entities: EntityName<AnyEntity>[],
    contextName?: string,
  ): DynamicModule {
    const queryServiceProviders = createMikroOrmQueryServiceProviders(
      entities,
      contextName,
    );
    const mikroOrmModule = MikroOrmModule.forFeature(entities, contextName);
    return {
      imports: [mikroOrmModule],
      module: NestjsQueryMikroOrmModule,
      providers: [...queryServiceProviders],
      exports: [...queryServiceProviders, mikroOrmModule],
    };
  }
}
