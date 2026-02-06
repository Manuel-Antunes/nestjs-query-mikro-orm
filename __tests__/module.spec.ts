import { NestjsQueryMikroOrmModule } from '../src';

describe('NestjsQueryMikroOrmModule', () => {
  it('should create a module', () => {
    class TestEntity {}
    const mikroOrmModule = NestjsQueryMikroOrmModule.forFeature([TestEntity]);
    expect(mikroOrmModule.imports).toHaveLength(1);
    expect(mikroOrmModule.module).toBe(NestjsQueryMikroOrmModule);
    expect(mikroOrmModule.providers).toHaveLength(1);
    expect(mikroOrmModule.exports).toHaveLength(2);
  });
});
