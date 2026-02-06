import { getRepositoryToken } from '@mikro-orm/nestjs';
import { getQueryServiceToken } from '@nestjs-query/core';

import { createMikroOrmQueryServiceProviders } from '../src/lib/providers';

describe('createMikroOrmQueryServiceProviders', () => {
  it('should create a provider for the entity', () => {
    class TestEntity {}
    const providers = createMikroOrmQueryServiceProviders([TestEntity]);
    expect(providers).toHaveLength(1);
    expect(providers[0].provide).toBe(getQueryServiceToken(TestEntity));
    expect(providers[0].inject).toEqual([getRepositoryToken(TestEntity)]);
    expect(typeof providers[0].useFactory).toBe('function');
  });
});
