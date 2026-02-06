import type { QBFilterQuery } from '@mikro-orm/core';
import type { Filter } from '@nestjs-query/core';

import {
  closeTestConnection,
  createTestConnection,
  getTestConnection,
} from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';
import { WhereBuilder } from '../../src/lib/query';

describe('WhereBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const getRepo = () => getTestConnection().em.getRepository(TestEntity);
  const getQueryBuilder = () => getRepo().createQueryBuilder();
  const createWhereBuilder = () => new WhereBuilder<TestEntity>();

  const getSQL = (filter: Filter<TestEntity>): { sql: string; bindings: readonly unknown[] } => {
    const mikroOrmFilter = createWhereBuilder().build(filter);
    const qb = getQueryBuilder();
    qb.where(mikroOrmFilter as QBFilterQuery<TestEntity>);
    return qb.getKnexQuery().toSQL();
  };

  it('should accept a empty filter', (): void => {
    const { sql, bindings } = getSQL({});
    expect(sql).toMatchSnapshot();
    expect(bindings).toMatchSnapshot();
  });

  it('or multiple operators for a single field together', (): void => {
    const { sql, bindings } = getSQL({
      numberType: { gt: 10, lt: 20, gte: 21, lte: 31 },
    });
    expect(sql).toMatchSnapshot();
    expect(bindings).toMatchSnapshot();
  });

  it('and multiple field comparisons together', (): void => {
    const { sql, bindings } = getSQL({
      numberType: { eq: 1 },
      stringType: { like: 'foo%' },
      boolType: { is: true },
    });
    expect(sql).toMatchSnapshot();
    expect(bindings).toMatchSnapshot();
  });

  describe('and', (): void => {
    it('and multiple expressions together', (): void => {
      const { sql, bindings } = getSQL({
        and: [
          { numberType: { gt: 10 } },
          { numberType: { lt: 20 } },
          { numberType: { gte: 30 } },
          { numberType: { lte: 40 } },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('and multiple filters together with multiple fields', (): void => {
      const { sql, bindings } = getSQL({
        and: [
          { numberType: { gt: 10 }, stringType: { like: 'foo%' } },
          { numberType: { lt: 20 }, stringType: { like: '%bar' } },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('should support nested ors', (): void => {
      const { sql, bindings } = getSQL({
        and: [
          { or: [{ numberType: { gt: 10 } }, { numberType: { lt: 20 } }] },
          { or: [{ numberType: { gte: 30 } }, { numberType: { lte: 40 } }] },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('should properly group AND with a sibling field comparison', (): void => {
      const { sql, bindings } = getSQL({
        and: [{ numberType: { gt: 2 } }, { numberType: { lt: 10 } }],
        stringType: { eq: 'foo' },
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });
  });

  describe('or', (): void => {
    it('or multiple expressions together', (): void => {
      const { sql, bindings } = getSQL({
        or: [
          { numberType: { gt: 10 } },
          { numberType: { lt: 20 } },
          { numberType: { gte: 30 } },
          { numberType: { lte: 40 } },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('and multiple and filters together', (): void => {
      const { sql, bindings } = getSQL({
        or: [
          { numberType: { gt: 10 }, stringType: { like: 'foo%' } },
          { numberType: { lt: 20 }, stringType: { like: '%bar' } },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('should support nested ands', (): void => {
      const { sql, bindings } = getSQL({
        or: [
          { and: [{ numberType: { gt: 10 } }, { numberType: { lt: 20 } }] },
          { and: [{ numberType: { gte: 30 } }, { numberType: { lte: 40 } }] },
        ],
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });

    it('should properly group OR with a sibling field comparison', (): void => {
      const { sql, bindings } = getSQL({
        or: [{ numberType: { eq: 2 } }, { numberType: { gt: 10 } }],
        stringType: { eq: 'foo' },
      });
      expect(sql).toMatchSnapshot();
      expect(bindings).toMatchSnapshot();
    });
  });
});
