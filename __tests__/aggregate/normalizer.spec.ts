import type { EntityMetadata, MikroORM } from '@mikro-orm/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeAggregateRecords } from '../../src';
import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { TestEntity } from '../__fixtures__/test.entity';

/**
 * The normalizer is what keeps the strategies interchangeable: each backend answers in its own
 * currency, and this coerces every record to the types `AggregateResponse` declares.
 */
describe('normalizeAggregateRecords', () => {
  let orm: MikroORM;

  beforeEach(async () => {
    orm = await createTestConnection();
  });
  afterEach(closeTestConnection);

  const meta = (): EntityMetadata<TestEntity> => orm.em.getMetadata().get(TestEntity);
  const normalize = (record: Record<string, unknown>) =>
    normalizeAggregateRecords([record], meta())[0];

  describe('numeric buckets', () => {
    it('should coerce a count to a number even over a text column', () => {
      expect(normalize({ COUNT_stringType: '10' })).toEqual({ COUNT_stringType: 10 });
    });

    it('should coerce sums and averages that arrived as strings', () => {
      expect(normalize({ SUM_numberType: '55', AVG_numberType: '5.5' })).toEqual({
        SUM_numberType: 55,
        AVG_numberType: 5.5,
      });
    });

    it('should express a summed date column as a number', () => {
      const date = new Date('2020-02-01T00:00:00.000Z');
      expect(normalize({ SUM_dateType: date })).toEqual({ SUM_dateType: date.getTime() });
    });
  });

  describe('max, min and groupBy keep the property type', () => {
    it('should rebuild a Date from the epoch milliseconds SQLite reports', () => {
      const record = normalize({ MAX_dateType: 1581206400000 });
      expect(record.MAX_dateType).toBeInstanceOf(Date);
      expect((record.MAX_dateType as Date).toISOString()).toBe('2020-02-09T00:00:00.000Z');
    });

    it('should rebuild a Date from the ISO string other drivers report', () => {
      const record = normalize({ MIN_dateType: '2020-02-09T00:00:00.000Z' });
      expect(record.MIN_dateType).toBeInstanceOf(Date);
    });

    it('should leave a Date alone when the driver already returned one', () => {
      const date = new Date('2020-02-09T00:00:00.000Z');
      expect(normalize({ MAX_dateType: date }).MAX_dateType).toBe(date);
    });

    it('should leave a value alone when it cannot be read as a date', () => {
      expect(normalize({ MAX_dateType: 'not a date' })).toEqual({ MAX_dateType: 'not a date' });
    });

    it('should turn the 0/1 SQL reports for a boolean back into a boolean', () => {
      expect(normalize({ GROUP_BY_boolType: 1 }).GROUP_BY_boolType).toBe(true);
      expect(normalize({ GROUP_BY_boolType: 0 }).GROUP_BY_boolType).toBe(false);
    });

    it('should leave a boolean alone when the driver already returned one', () => {
      expect(normalize({ GROUP_BY_boolType: true }).GROUP_BY_boolType).toBe(true);
    });

    it('should coerce a numeric column that arrived as a string', () => {
      expect(normalize({ MAX_numberType: '10' })).toEqual({ MAX_numberType: 10 });
    });

    it('should leave a text column as it is', () => {
      expect(normalize({ MAX_stringType: 'z' })).toEqual({ MAX_stringType: 'z' });
    });
  });

  describe('values it must not touch', () => {
    it('should pass null and undefined straight through', () => {
      expect(normalize({ MAX_dateType: null, MIN_numberType: undefined })).toEqual({
        MAX_dateType: null,
        MIN_numberType: undefined,
      });
    });

    it('should leave a key that is not an aggregate alias alone', () => {
      expect(normalize({ somethingElse: 'kept' })).toEqual({ somethingElse: 'kept' });
    });

    it('should leave an alias for an unknown property alone', () => {
      expect(normalize({ MAX_notAProperty: 'kept' })).toEqual({ MAX_notAProperty: 'kept' });
    });

    it('should not treat a null _id as a nested grouping', () => {
      expect(normalize({ _id: null, COUNT_testEntityPk: 1 })).toEqual({
        _id: null,
        COUNT_testEntityPk: 1,
      });
    });

    it('should not walk into an _id that is a scalar', () => {
      expect(normalize({ _id: 'row-1' })).toEqual({ _id: 'row-1' });
    });

    it('should not walk into an _id that is a Date', () => {
      const date = new Date('2020-02-09T00:00:00.000Z');
      expect(normalize({ _id: date })._id).toBe(date);
    });
  });

  describe('MongoDB grouped columns', () => {
    it('should normalize the columns nested under _id', () => {
      const record = normalize({ _id: { GROUP_BY_boolType: 1 }, COUNT_testEntityPk: '5' });
      expect(record).toEqual({
        _id: { GROUP_BY_boolType: true },
        COUNT_testEntityPk: 5,
      });
    });

    it('should normalize a date nested under _id', () => {
      const record = normalize({ _id: { GROUP_BY_dateType: 1581206400000 } });
      expect((record._id as Record<string, unknown>).GROUP_BY_dateType).toBeInstanceOf(Date);
    });
  });

  it('should normalize every record it is given', () => {
    const records = normalizeAggregateRecords(
      [{ GROUP_BY_boolType: 1 }, { GROUP_BY_boolType: 0 }],
      meta(),
    );
    expect(records).toEqual([{ GROUP_BY_boolType: true }, { GROUP_BY_boolType: false }]);
  });
});
