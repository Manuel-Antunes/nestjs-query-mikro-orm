import { describe, expect, it } from 'vitest';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { getQueryServiceToken } from '@ptc-org/nestjs-query-core';

import type { MikroOrmQueryService } from '../src';
import { InMemoryAggregateStrategy, NestjsQueryMikroOrmModule } from '../src';

describe('NestjsQueryMikroOrmModule', () => {
  class TestEntity {}
  class TestDto {}

  /** The factory only resolves the entity class and registers the default serializers. */
  const repoStub = {
    getEntityName: () => TestEntity.name,
    getEntityManager: () => ({
      getMetadata: () => ({ get: () => ({ class: TestEntity, primaryKeys: ['id'] }) }),
    }),
  };

  it('should create a module', () => {
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([TestEntity]);
    expect(mikroOrmModule.imports).toHaveLength(1);
    expect(mikroOrmModule.module).toBe(NestjsQueryMikroOrmModule);
    expect(mikroOrmModule.providers).toHaveLength(1);
    expect(mikroOrmModule.exports).toHaveLength(2);
  });

  it('should accept entities paired with a dto', () => {
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([
      { entity: TestEntity, dto: TestDto },
    ]);
    expect(mikroOrmModule.providers).toHaveLength(1);
    expect(mikroOrmModule.providers?.[0]).toMatchObject({
      provide: getQueryServiceToken(TestDto),
    });
  });

  it('should share service options with every entity it registers', () => {
    const aggregateStrategy = new InMemoryAggregateStrategy();
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([TestEntity], {
      aggregateStrategy,
      useSoftDelete: true,
    });

    // the factory is what carries the options through to the service
    const provider = mikroOrmModule.providers?.[0] as {
      useFactory: (repo: unknown) => MikroOrmQueryService<TestEntity>;
    };
    const service = provider.useFactory(repoStub);
    expect(service.aggregateStrategy).toBe(aggregateStrategy);
    expect(service.useSoftDelete).toBe(true);
  });

  it('should keep accepting a bare context name', () => {
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([TestEntity], 'other-connection');
    expect(mikroOrmModule.providers?.[0]).toMatchObject({
      inject: [getRepositoryToken(TestEntity, 'other-connection')],
    });
  });

  it('should take the context name from the options object', () => {
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([TestEntity], {
      contextName: 'other-connection',
      useSoftDelete: true,
    });
    expect(mikroOrmModule.providers?.[0]).toMatchObject({
      inject: [getRepositoryToken(TestEntity, 'other-connection')],
    });
  });

  it('should mix both forms in a single call', () => {
    class OtherEntity {}
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([
      TestEntity,
      { entity: OtherEntity, dto: TestDto },
    ]);
    expect(mikroOrmModule.providers).toHaveLength(2);
    expect(mikroOrmModule.exports).toHaveLength(3);
  });
});
