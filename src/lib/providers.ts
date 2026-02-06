import type { AnyEntity, EntityName } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/knex';
import type { FactoryProvider } from '@nestjs/common';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { getQueryServiceToken } from '@nestjs-query/core';

import { MikroOrmQueryService } from './services';

function createMikroOrmQueryServiceProvider<Entity extends object>(
  EntityClass: EntityName<Entity>,
  contextName?: string,
): FactoryProvider {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provide: getQueryServiceToken(EntityClass as any),
    useFactory(repo: EntityRepository<Entity>) {
      return new MikroOrmQueryService(repo);
    },
    inject: [getRepositoryToken(EntityClass, contextName)],
  };
}

export const createMikroOrmQueryServiceProviders = (
  entities: EntityName<AnyEntity>[],
  contextName?: string,
): FactoryProvider[] =>
  entities.map((entity) =>
    createMikroOrmQueryServiceProvider(entity, contextName),
  );
