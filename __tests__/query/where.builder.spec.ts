import type { Filter } from '@ptc-org/nestjs-query-core';

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

  describe('every operator', () => {
    it.each([
      ['eq', { numberType: { eq: 1 } }, { numberType: { $eq: 1 } }],
      ['neq', { numberType: { neq: 1 } }, { numberType: { $ne: 1 } }],
      ['gt', { numberType: { gt: 1 } }, { numberType: { $gt: 1 } }],
      ['gte', { numberType: { gte: 1 } }, { numberType: { $gte: 1 } }],
      ['lt', { numberType: { lt: 1 } }, { numberType: { $lt: 1 } }],
      ['lte', { numberType: { lte: 1 } }, { numberType: { $lte: 1 } }],
      ['like', { stringType: { like: 'a%' } }, { stringType: { $like: 'a%' } }],
      ['notLike', { stringType: { notLike: 'a%' } }, { stringType: { $not: { $like: 'a%' } } }],
      ['iLike', { stringType: { iLike: 'a%' } }, { stringType: { $ilike: 'a%' } }],
      ['notILike', { stringType: { notILike: 'a%' } }, { stringType: { $not: { $ilike: 'a%' } } }],
      ['in', { numberType: { in: [1, 2] } }, { numberType: { $in: [1, 2] } }],
      ['notIn', { numberType: { notIn: [1, 2] } }, { numberType: { $nin: [1, 2] } }],
      [
        'between',
        { numberType: { between: { lower: 1, upper: 5 } } },
        { numberType: { $gte: 1, $lte: 5 } },
      ],
      [
        'notBetween',
        { numberType: { notBetween: { lower: 1, upper: 5 } } },
        { numberType: { $or: [{ $lt: 1 }, { $gt: 5 }] } },
      ],
    ] as [string, Filter<TestEntity>, unknown][])('should map %s', (_name, filter, expected) => {
      expect(buildFilter(filter)).toEqual(expected);
    });

    it.each([
      ['is null', { stringType: { is: null } }, { stringType: { $eq: null } }],
      ['is true', { boolType: { is: true } }, { boolType: { $eq: true } }],
      ['is false', { boolType: { is: false } }, { boolType: { $eq: false } }],
      ['isNot null', { stringType: { isNot: null } }, { stringType: { $ne: null } }],
      ['isNot true', { boolType: { isNot: true } }, { boolType: { $ne: true } }],
      ['isNot false', { boolType: { isNot: false } }, { boolType: { $ne: false } }],
    ] as [string, Filter<TestEntity>, unknown][])('should map %s', (_name, filter, expected) => {
      expect(buildFilter(filter)).toEqual(expected);
    });
  });

  describe('rejected input', () => {
    it('should reject an unknown operator sitting next to a known one', () => {
      expect(() =>
        buildFilter({ numberType: { eq: 1, nope: 2 } } as unknown as Filter<TestEntity>),
      ).toThrow('Unknown operator nope');
    });

    it('should read a wholly unknown key as a nested relation filter, not an operator', () => {
      // a comparison is recognised by carrying at least one known operator; a mistyped one like
      // `eqq` therefore looks like a relation and is recursed into rather than rejected
      expect(buildFilter({ numberType: { eqq: 1 } } as unknown as Filter<TestEntity>)).toEqual({
        numberType: { eqq: {} },
      });
    });

    it('should reject a non-boolean, non-null `is`', () => {
      expect(() =>
        buildFilter({ stringType: { is: 'yes' } } as unknown as Filter<TestEntity>),
      ).toThrow('Unexpected is operator param "yes"');
    });

    it('should reject a non-boolean, non-null `isNot`', () => {
      expect(() =>
        buildFilter({ stringType: { isNot: 'yes' } } as unknown as Filter<TestEntity>),
      ).toThrow('Unexpected isNot operator param "yes"');
    });

    it.each([
      ['between', 'Invalid value for between'],
      ['notBetween', 'Invalid value for not between'],
    ])('should reject a malformed %s range', (operator, message) => {
      expect(() =>
        buildFilter({ numberType: { [operator]: 5 } } as unknown as Filter<TestEntity>),
      ).toThrow(message);
    });
  });

  describe('composition', () => {
    it('should ignore an empty and/or', () => {
      expect(buildFilter({ and: [], or: [] })).toEqual({});
    });

    it('should combine and with a field comparison', () => {
      expect(buildFilter({ and: [{ numberType: { eq: 1 } }], stringType: { eq: 'a' } })).toEqual({
        $and: [{ $and: [{ numberType: { $eq: 1 } }] }, { stringType: { $eq: 'a' } }],
      });
    });

    it('should combine and with or', () => {
      expect(
        buildFilter({ and: [{ numberType: { eq: 1 } }], or: [{ numberType: { eq: 2 } }] }),
      ).toEqual({
        $and: [{ $and: [{ numberType: { $eq: 1 } }] }, { $or: [{ numberType: { $eq: 2 } }] }],
      });
    });

    it('should skip a field whose comparison is undefined', () => {
      expect(buildFilter({ stringType: undefined, numberType: { eq: 1 } })).toEqual({
        numberType: { $eq: 1 },
      });
    });

    it('should recurse into a nested relation filter', () => {
      expect(buildFilter({ oneTestRelation: { relationName: { eq: 'a' } } })).toEqual({
        oneTestRelation: { relationName: { $eq: 'a' } },
      });
    });

    it('should treat an array value as a comparison rather than a relation', () => {
      expect(buildFilter({ numberType: { in: [1] } })).toEqual({ numberType: { $in: [1] } });
    });
  });
});
