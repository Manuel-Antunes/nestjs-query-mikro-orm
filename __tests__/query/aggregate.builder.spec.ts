import { describe, expect, it } from 'vitest';

import { AggregateBuilder } from '../../src/lib/query';
import { TestEntity } from '../__fixtures__/test.entity';

describe('AggregateBuilder', (): void => {
  describe('.getAggregateAlias', () => {
    it('should name a column after the function and the property', () => {
      expect(AggregateBuilder.getAggregateAlias<TestEntity>('COUNT', 'testEntityPk')).toBe(
        'COUNT_testEntityPk',
      );
      expect(AggregateBuilder.getAggregateAlias<TestEntity>('MAX', 'dateType')).toBe(
        'MAX_dateType',
      );
    });
  });

  describe('.getGroupByAlias', () => {
    it('should prefix a grouped column', () => {
      expect(AggregateBuilder.getGroupByAlias<TestEntity>('stringType')).toBe(
        'GROUP_BY_stringType',
      );
    });
  });

  describe('.convertToAggregateResponse', () => {
    it('should convert a flat response into an Aggregate response', () => {
      const dbResult = [
        {
          GROUP_BY_stringType: 'z',
          COUNT_testEntityPk: 10,
          SUM_numberType: 55,
          AVG_numberType: 5,
          MAX_stringType: 'z',
          MAX_numberType: 10,
          MIN_stringType: 'a',
          MIN_numberType: 1,
        },
      ];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        {
          groupBy: { stringType: 'z' },
          count: { testEntityPk: 10 },
          sum: { numberType: 55 },
          avg: { numberType: 5 },
          max: { stringType: 'z', numberType: 10 },
          min: { stringType: 'a', numberType: 1 },
        },
      ]);
    });

    it('should convert one record per group', () => {
      const dbResult = [
        { GROUP_BY_boolType: true, COUNT_testEntityPk: 5 },
        { GROUP_BY_boolType: false, COUNT_testEntityPk: 5 },
      ];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        { groupBy: { boolType: true }, count: { testEntityPk: 5 } },
        { groupBy: { boolType: false }, count: { testEntityPk: 5 } },
      ]);
    });

    it('should read the grouped columns MongoDB nests under _id', () => {
      const dbResult = [
        {
          _id: { GROUP_BY_boolType: true },
          COUNT_testEntityPk: 5,
        },
      ];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        { groupBy: { boolType: true }, count: { testEntityPk: 5 } },
      ]);
    });

    it('should ignore the ungrouped _id MongoDB reports as null', () => {
      const dbResult = [{ _id: null, COUNT_testEntityPk: 10 }];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        { count: { testEntityPk: 10 } },
      ]);
    });

    it('should accept the lower case aliases some drivers fold columns into', () => {
      const dbResult = [{ count_testEntityPk: 3, group_by_stringType: 'a' }];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        { count: { testEntityPk: 3 }, groupBy: { stringType: 'a' } },
      ]);
    });

    it('should merge several columns into the same bucket', () => {
      const dbResult = [{ MAX_numberType: 10, MAX_stringType: 'z' }];
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toEqual([
        { max: { numberType: 10, stringType: 'z' } },
      ]);
    });

    it('should return nothing for no records', () => {
      expect(AggregateBuilder.convertToAggregateResponse<TestEntity>([])).toEqual([]);
    });

    it('should throw an error if a column is not expected', () => {
      const dbResult = [
        {
          COUNTtestEntityPk: 10,
        },
      ];
      expect(() => AggregateBuilder.convertToAggregateResponse<TestEntity>(dbResult)).toThrow(
        'Unknown aggregate column encountered.',
      );
    });
  });

  describe('.asyncConvertToAggregateResponse', () => {
    it('should await the records before converting them', async () => {
      const dbResult = Promise.resolve([{ COUNT_testEntityPk: 7 }]);
      await expect(
        AggregateBuilder.asyncConvertToAggregateResponse<TestEntity>(dbResult),
      ).resolves.toEqual([{ count: { testEntityPk: 7 } }]);
    });

    it('should surface a rejection from the records it was given', async () => {
      await expect(
        AggregateBuilder.asyncConvertToAggregateResponse<TestEntity>(
          Promise.reject(new Error('query failed')),
        ),
      ).rejects.toThrow('query failed');
    });
  });
});
