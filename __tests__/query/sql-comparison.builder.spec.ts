import type { CommonFieldComparisonBetweenType } from '@nestjs-query/core';

import type { TestEntity } from '../__fixtures__/test.entity';
import { SQLComparisonBuilder } from '../../src/lib/query';

/**
 * Tests for SQLComparisonBuilder - builds MikroORM filter objects
 * from nestjs-query comparison operators.
 *
 * Note: MikroORM uses object-based filters instead of SQL strings,
 * so these tests verify the correct filter object structure is produced.
 */
describe('SQLComparisonBuilder', (): void => {
  const createSQLComparisonBuilder = () => new SQLComparisonBuilder<TestEntity>();

  it('should throw an error for an invalid comparison type', () => {
    expect(() =>
      // @ts-expect-error Testing invalid operator
      createSQLComparisonBuilder().build('stringType', 'bad', 'foo'),
    ).toThrow('Unknown operator');
  });

  describe('eq comparisons', () => {
    it('should build eq filter', (): void => {
      expect(createSQLComparisonBuilder().build('stringType', 'eq', 'foo')).toEqual({
        stringType: { $eq: 'foo' },
      });
    });
  });

  describe('neq comparisons', () => {
    it('should build neq filter', (): void => {
      expect(createSQLComparisonBuilder().build('numberType', 'neq', 1)).toEqual({
        numberType: { $ne: 1 },
      });
    });
  });

  describe('gt comparisons', () => {
    it('should build gt filter', (): void => {
      expect(createSQLComparisonBuilder().build('numberType', 'gt', 1)).toEqual({
        numberType: { $gt: 1 },
      });
    });
  });

  describe('gte comparisons', () => {
    it('should build gte filter', (): void => {
      expect(createSQLComparisonBuilder().build('numberType', 'gte', 1)).toEqual({
        numberType: { $gte: 1 },
      });
    });
  });

  describe('lt comparisons', () => {
    it('should build lt filter', (): void => {
      expect(createSQLComparisonBuilder().build('numberType', 'lt', 1)).toEqual({
        numberType: { $lt: 1 },
      });
    });
  });

  describe('lte comparisons', () => {
    it('should build lte filter', (): void => {
      expect(createSQLComparisonBuilder().build('numberType', 'lte', 1)).toEqual({
        numberType: { $lte: 1 },
      });
    });
  });

  describe('like comparisons', () => {
    it('should build like filter', (): void => {
      expect(createSQLComparisonBuilder().build('stringType', 'like', '%hello%')).toEqual({
        stringType: { $like: '%hello%' },
      });
    });
  });

  describe('notLike comparisons', () => {
    it('should build notLike filter', (): void => {
      expect(createSQLComparisonBuilder().build('stringType', 'notLike', '%hello%')).toEqual({
        stringType: { $not: { $like: '%hello%' } },
      });
    });
  });

  describe('iLike comparisons', () => {
    it('should build iLike filter', (): void => {
      expect(createSQLComparisonBuilder().build('stringType', 'iLike', '%hello%')).toEqual({
        stringType: { $ilike: '%hello%' },
      });
    });
  });

  describe('notILike comparisons', () => {
    it('should build notILike filter', (): void => {
      expect(createSQLComparisonBuilder().build('stringType', 'notILike', '%hello%')).toEqual({
        stringType: { $not: { $ilike: '%hello%' } },
      });
    });
  });

  describe('is comparisons', () => {
    it('should build is true filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'is', true)).toEqual({
        boolType: { $eq: true },
      });
    });

    it('should build is false filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'is', false)).toEqual({
        boolType: { $eq: false },
      });
    });

    it('should build is null filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'is', null)).toEqual({
        boolType: { $eq: null },
      });
    });

    it('should throw an error for values other than null true or false', () => {
      expect(() =>
        // @ts-expect-error Testing invalid value
        createSQLComparisonBuilder().build('boolType', 'is', 'foo'),
      ).toThrow('Unexpected is operator param');
    });
  });

  describe('isNot comparisons', () => {
    it('should build isNot true filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'isNot', true)).toEqual({
        boolType: { $ne: true },
      });
    });

    it('should build isNot false filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'isNot', false)).toEqual({
        boolType: { $ne: false },
      });
    });

    it('should build isNot null filter', (): void => {
      expect(createSQLComparisonBuilder().build('boolType', 'isNot', null)).toEqual({
        boolType: { $ne: null },
      });
    });

    it('should throw an error for values other than null true or false', () => {
      expect(() =>
        // @ts-expect-error Testing invalid value
        createSQLComparisonBuilder().build('boolType', 'isNot', 'foo'),
      ).toThrow('Unexpected isNot operator param');
    });
  });

  describe('in comparisons', () => {
    it('should build in filter', (): void => {
      const arr = [1, 2, 3];
      expect(createSQLComparisonBuilder().build('numberType', 'in', arr)).toEqual({
        numberType: { $in: arr },
      });
    });

    it('should throw an error for empty array', (): void => {
      const arr: number[] = [];
      expect(() => createSQLComparisonBuilder().build('numberType', 'in', arr)).toThrow(
        'Invalid in value expected a non-empty array got []',
      );
    });

    it('should throw an error for non-array', (): void => {
      expect(() => createSQLComparisonBuilder().build('numberType', 'in', 1)).toThrow(
        'Invalid in value expected an array got 1',
      );
    });
  });

  describe('notIn comparisons', () => {
    it('should build notIn filter', (): void => {
      const arr = ['a', 'b', 'c'];
      expect(createSQLComparisonBuilder().build('stringType', 'notIn', arr)).toEqual({
        stringType: { $nin: arr },
      });
    });

    it('should throw an error for empty array', (): void => {
      const arr: number[] = [];
      expect(() => createSQLComparisonBuilder().build('numberType', 'notIn', arr)).toThrow(
        'Invalid in value expected a non-empty array got []',
      );
    });

    it('should throw an error for non-array', (): void => {
      expect(() => createSQLComparisonBuilder().build('numberType', 'notIn', 1)).toThrow(
        'Invalid in value expected an array got 1',
      );
    });
  });

  describe('between comparisons', () => {
    it('should build between filter', (): void => {
      const between: CommonFieldComparisonBetweenType<number> = {
        lower: 1,
        upper: 10,
      };
      expect(createSQLComparisonBuilder().build('numberType', 'between', between)).toEqual({
        numberType: { $gte: 1, $lte: 10 },
      });
    });

    it('should throw an error if the comparison is not a between comparison', (): void => {
      const between = [1, 10];
      expect(() => createSQLComparisonBuilder().build('numberType', 'between', between)).toThrow(
        'Invalid value for between expected {lower: val, upper: val} got [1,10]',
      );
    });
  });

  describe('notBetween comparisons', () => {
    it('should build notBetween filter', (): void => {
      const between: CommonFieldComparisonBetweenType<number> = {
        lower: 1,
        upper: 10,
      };
      expect(createSQLComparisonBuilder().build('numberType', 'notBetween', between)).toEqual({
        $or: [{ numberType: { $lt: 1 } }, { numberType: { $gt: 10 } }],
      });
    });

    it('should throw an error if the comparison is not a between comparison', (): void => {
      const between = [1, 10];
      expect(() => createSQLComparisonBuilder().build('numberType', 'notBetween', between)).toThrow(
        'Invalid value for not between expected {lower: val, upper: val} got [1,10]',
      );
    });
  });
});
