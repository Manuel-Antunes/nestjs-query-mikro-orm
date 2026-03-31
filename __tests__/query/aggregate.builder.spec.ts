import type { AggregateQuery } from '@ptc-org/nestjs-query-core';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateBuilder } from '../../src/lib/query';
import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';

describe('AggregateBuilder', (): void => {
  beforeEach(createTestConnection);
  afterEach(closeTestConnection);

  const getSelects = (agg: AggregateQuery<TestEntity>) =>
    AggregateBuilder.buildSelectExpressions<TestEntity>(agg, 'TestEntity');

  it('should throw an error if no selects are generated', (): void => {
    expect(() => AggregateBuilder.buildSelectExpressions({}, 'TestEntity' as any)).toThrow(
      'No aggregate fields found.',
    );
  });

  it('should create selects for all aggregate functions', (): void => {
    const selects = getSelects({
      count: ['testEntityPk'],
      avg: ['numberType'],
      sum: ['numberType'],
      max: ['stringType', 'dateType', 'numberType'],
      min: ['stringType', 'dateType', 'numberType'],
    });
    expect(selects.map((s) => s[0]).join(',')).toContain('COUNT');
  });

  it('should create selects for all aggregate functions and group bys', (): void => {
    const selects = getSelects({
      groupBy: ['stringType', 'boolType'],
      count: ['testEntityPk'],
    });
    expect(selects.map((s) => s[1]).join(',')).toContain('GROUP_BY');
  });

  it('should only generate selects for requested aggregate functions', (): void => {
    const selects = getSelects({
      sum: ['numberType'],
    });
    const selectExprs = selects.map((s) => s[0]).join(',');
    expect(selectExprs).toContain('SUM');
    expect(selectExprs).not.toContain('COUNT');
    expect(selectExprs).not.toContain('AVG');
    expect(selectExprs).not.toContain('MAX');
    expect(selectExprs).not.toContain('MIN');
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
});
