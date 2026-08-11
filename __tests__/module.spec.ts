import { describe, expect, it } from 'vitest';
import { getQueryServiceToken } from '@ptc-org/nestjs-query-core';

import { NestjsQueryMikroOrmModule } from '../src';

describe('NestjsQueryMikroOrmModule', () => {
  class TestEntity {}
  class TestDto {}

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
