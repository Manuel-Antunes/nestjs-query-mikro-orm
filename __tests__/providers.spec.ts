import { getRepositoryToken } from '@mikro-orm/nestjs';
import { getQueryServiceToken } from '@nestjs-query/core';
import { vi } from 'vitest';

import { createMikroOrmQueryServiceProviders } from '../src/lib/providers';
import { MikroOrmQueryService } from '../src/lib/services';

describe('createMikroOrmQueryServiceProviders', () => {
  it('should create a provider for the entity', () => {
    class TestEntity {}
    // Create a mock repository with required methods
    const mockRepo = {
      getEntityName: vi.fn().mockReturnValue('TestEntity'),
      getEntityManager: vi.fn().mockReturnValue({
        getMetadata: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({}),
        }),
      }),
      createQueryBuilder: vi.fn(),
    };
    const providers = createMikroOrmQueryServiceProviders([TestEntity]);
    expect(providers).toHaveLength(1);
    expect(providers[0].provide).toBe(getQueryServiceToken(TestEntity));
    expect(providers[0].inject).toEqual([getRepositoryToken(TestEntity)]);
    expect(providers[0].useFactory(mockRepo as any)).toBeInstanceOf(
      MikroOrmQueryService,
    );
  });
});
