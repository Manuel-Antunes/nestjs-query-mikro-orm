import type { Filter } from '@nestjs-query/core';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WhereBuilder } from '../../src/lib/query';
import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';

describe('WhereBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const createWhereBuilder = () => new WhereBuilder<TestEntity>();

  const buildFilter = (filter: Filter<TestEntity>) => createWhereBuilder().build(filter);

  it('should accept a empty filter', (): void => {
    const mikroOrmFilter = buildFilter({});
    expect(mikroOrmFilter).toMatchSnapshot();
  });

  it('or multiple operators for a single field together', (): void => {
    const mikroOrmFilter = buildFilter({
      numberType: { gt: 10, lt: 20, gte: 21, lte: 31 },
    });
    expect(mikroOrmFilter).toMatchSnapshot();
  });

  it('and multiple field comparisons together', (): void => {
    const mikroOrmFilter = buildFilter({
      numberType: { eq: 1 },
      stringType: { like: 'foo%' },
      boolType: { is: true },
    });
    expect(mikroOrmFilter).toMatchSnapshot();
  });

  describe('and', (): void => {
    it('and multiple expressions together', (): void => {
      const mikroOrmFilter = buildFilter({
        and: [
          { numberType: { gt: 10 } },
          { numberType: { lt: 20 } },
          { numberType: { gte: 30 } },
          { numberType: { lte: 40 } },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('and multiple filters together with multiple fields', (): void => {
      const mikroOrmFilter = buildFilter({
        and: [
          { numberType: { gt: 10 }, stringType: { like: 'foo%' } },
          { numberType: { lt: 20 }, stringType: { like: '%bar' } },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('should support nested ors', (): void => {
      const mikroOrmFilter = buildFilter({
        and: [
          { or: [{ numberType: { gt: 10 } }, { numberType: { lt: 20 } }] },
          { or: [{ numberType: { gte: 30 } }, { numberType: { lte: 40 } }] },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('should properly group AND with a sibling field comparison', (): void => {
      const mikroOrmFilter = buildFilter({
        and: [{ numberType: { gt: 2 } }, { numberType: { lt: 10 } }],
        stringType: { eq: 'foo' },
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });
  });

  describe('or', (): void => {
    it('or multiple expressions together', (): void => {
      const mikroOrmFilter = buildFilter({
        or: [
          { numberType: { gt: 10 } },
          { numberType: { lt: 20 } },
          { numberType: { gte: 30 } },
          { numberType: { lte: 40 } },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('and multiple and filters together', (): void => {
      const mikroOrmFilter = buildFilter({
        or: [
          { numberType: { gt: 10 }, stringType: { like: 'foo%' } },
          { numberType: { lt: 20 }, stringType: { like: '%bar' } },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('should support nested ands', (): void => {
      const mikroOrmFilter = buildFilter({
        or: [
          { and: [{ numberType: { gt: 10 } }, { numberType: { lt: 20 } }] },
          { and: [{ numberType: { gte: 30 } }, { numberType: { lte: 40 } }] },
        ],
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });

    it('should properly group OR with a sibling field comparison', (): void => {
      const mikroOrmFilter = buildFilter({
        or: [{ numberType: { eq: 2 } }, { numberType: { gt: 10 } }],
        stringType: { eq: 'foo' },
      });
      expect(mikroOrmFilter).toMatchSnapshot();
    });
  });
});
