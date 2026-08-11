import type { EntityRepository } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import type { AggregateQuery, AggregateResponse, Query } from '@ptc-org/nestjs-query-core';
import {
  AbstractAssembler,
  AssemblerQueryService,
  getQueryServiceToken,
} from '@ptc-org/nestjs-query-core';

import { createMikroOrmQueryServiceProviders } from '../src/lib/providers';
import { InMemoryAggregateStrategy, MikroOrmQueryService } from '../src';

class TestEntity {
  id!: string;

  stringType!: string;
}

class TestDto {
  id!: string;

  stringType!: string;
}

class TestAssembler extends AbstractAssembler<TestDto, TestEntity> {
  constructor() {
    super(TestDto, TestEntity);
  }

  convertToDTO(entity: TestEntity): TestDto {
    return entity as unknown as TestDto;
  }

  convertToEntity(dto: TestDto): TestEntity {
    return dto as unknown as TestEntity;
  }

  convertQuery(query: Query<TestDto>): Query<TestEntity> {
    return query as unknown as Query<TestEntity>;
  }

  convertAggregateQuery(aggregate: AggregateQuery<TestDto>): AggregateQuery<TestEntity> {
    return aggregate as unknown as AggregateQuery<TestEntity>;
  }

  convertAggregateResponse(aggregate: AggregateResponse<TestEntity>): AggregateResponse<TestDto> {
    return aggregate as unknown as AggregateResponse<TestDto>;
  }

  convertToCreateEntity(create: Partial<TestDto>): Partial<TestEntity> {
    return create as Partial<TestEntity>;
  }

  convertToUpdateEntity(update: Partial<TestDto>): Partial<TestEntity> {
    return update as Partial<TestEntity>;
  }
}

/**
 * The factory only touches the repo to resolve the entity class and register the default
 * serializers, so the metadata lookup is all that has to be real here.
 */
const repoStub = <Entity extends object>(EntityClass: new () => Entity) =>
  ({
    getEntityName: () => EntityClass.name,
    getEntityManager: () => ({
      getMetadata: () => ({
        get: () => ({ class: EntityClass, primaryKeys: ['id'] }),
      }),
    }),
  }) as unknown as EntityRepository<Entity>;

describe('createMikroOrmQueryServiceProviders', () => {
  it('should create a provider for the entity', () => {
    const providers = createMikroOrmQueryServiceProviders([TestEntity]);
    expect(providers).toHaveLength(1);
    expect(providers[0].provide).toBe(getQueryServiceToken(TestEntity));
    expect(providers[0].inject).toEqual([getRepositoryToken(TestEntity)]);
    expect(typeof providers[0].useFactory).toBe('function');
  });

  it('should accept the entity wrapped in an options object', () => {
    const providers = createMikroOrmQueryServiceProviders([{ entity: TestEntity }]);
    expect(providers).toHaveLength(1);
    expect(providers[0].provide).toBe(getQueryServiceToken(TestEntity));
    expect(providers[0].inject).toEqual([getRepositoryToken(TestEntity)]);
  });

  it('should build a plain query service when no dto is given', () => {
    const [provider] = createMikroOrmQueryServiceProviders([TestEntity]);
    const service = provider.useFactory(repoStub(TestEntity));
    expect(service).toBeInstanceOf(MikroOrmQueryService);
  });

  it('should register the service under the dto token when a dto is given', () => {
    const [provider] = createMikroOrmQueryServiceProviders([{ entity: TestEntity, dto: TestDto }]);
    expect(provider.provide).toBe(getQueryServiceToken(TestDto));
    // the repository still comes from the entity, only the token follows the dto
    expect(provider.inject).toEqual([getRepositoryToken(TestEntity)]);
  });

  it('should wrap the query service in an assembler when a dto is given', () => {
    const [provider] = createMikroOrmQueryServiceProviders([{ entity: TestEntity, dto: TestDto }]);
    const service = provider.useFactory(repoStub(TestEntity));
    expect(service).toBeInstanceOf(AssemblerQueryService);
    expect(service.queryService).toBeInstanceOf(MikroOrmQueryService);
  });

  it('should use the assembler class when one is given', () => {
    const [provider] = createMikroOrmQueryServiceProviders([
      { entity: TestEntity, dto: TestDto, assembler: TestAssembler },
    ]);
    const service = provider.useFactory(repoStub(TestEntity));
    expect(service).toBeInstanceOf(AssemblerQueryService);
    expect(service.assembler).toBeInstanceOf(TestAssembler);
  });

  describe('service options', () => {
    it('should hand the shared options to every service it registers', () => {
      const aggregateStrategy = new InMemoryAggregateStrategy();
      const providers = createMikroOrmQueryServiceProviders([TestEntity, { entity: TestEntity }], {
        aggregateStrategy,
        useSoftDelete: true,
      });

      providers.forEach((provider) => {
        const service = provider.useFactory(
          repoStub(TestEntity),
        ) as MikroOrmQueryService<TestEntity>;
        expect(service.aggregateStrategy).toBe(aggregateStrategy);
        expect(service.useSoftDelete).toBe(true);
      });
    });

    it('should let an entry override the shared options', () => {
      const shared = new InMemoryAggregateStrategy();
      const mine = new InMemoryAggregateStrategy();
      const [plain, overridden] = createMikroOrmQueryServiceProviders(
        [TestEntity, { entity: TestEntity, aggregateStrategy: mine, useSoftDelete: false }],
        { aggregateStrategy: shared, useSoftDelete: true },
      );

      const plainService = plain.useFactory(
        repoStub(TestEntity),
      ) as MikroOrmQueryService<TestEntity>;
      const ownService = overridden.useFactory(
        repoStub(TestEntity),
      ) as MikroOrmQueryService<TestEntity>;

      expect(plainService.aggregateStrategy).toBe(shared);
      expect(plainService.useSoftDelete).toBe(true);
      expect(ownService.aggregateStrategy).toBe(mine);
      expect(ownService.useSoftDelete).toBe(false);
    });

    it('should reach the service behind an assembler too', () => {
      const aggregateStrategy = new InMemoryAggregateStrategy();
      const [provider] = createMikroOrmQueryServiceProviders(
        [{ entity: TestEntity, dto: TestDto }],
        { aggregateStrategy },
      );
      const service = provider.useFactory(repoStub(TestEntity)) as AssemblerQueryService<
        TestDto,
        TestEntity
      >;

      expect((service.queryService as MikroOrmQueryService<TestEntity>).aggregateStrategy).toBe(
        aggregateStrategy,
      );
    });

    it('should default to an in-memory strategy when nothing is given', () => {
      const [provider] = createMikroOrmQueryServiceProviders([TestEntity]);
      const service = provider.useFactory(repoStub(TestEntity)) as MikroOrmQueryService<TestEntity>;

      expect(service.aggregateStrategy).toBeInstanceOf(InMemoryAggregateStrategy);
      expect(service.useSoftDelete).toBe(false);
    });

    it('should still accept a bare context name as the second argument', () => {
      const [provider] = createMikroOrmQueryServiceProviders([TestEntity], 'other-connection');
      expect(provider.inject).toEqual([getRepositoryToken(TestEntity, 'other-connection')]);
    });

    it('should read the context name out of the options object', () => {
      const [provider] = createMikroOrmQueryServiceProviders([TestEntity], {
        contextName: 'other-connection',
        useSoftDelete: true,
      });
      expect(provider.inject).toEqual([getRepositoryToken(TestEntity, 'other-connection')]);
    });
  });

  it('should pass the context name on to the repository token', () => {
    const [provider] = createMikroOrmQueryServiceProviders([TestEntity], 'other-connection');
    expect(provider.inject).toEqual([getRepositoryToken(TestEntity, 'other-connection')]);
  });
});
