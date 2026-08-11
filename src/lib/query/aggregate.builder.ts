import type { AggregateResponse } from '@ptc-org/nestjs-query-core';

import type { AggregateFunction, AggregateRecord } from '../aggregate/aggregate.strategy';
import { aggregateAlias, groupByAlias } from '../aggregate/aggregate.strategy';

// Matches aggregate column prefixes in a case-insensitive way and multiple naming styles
const AGG_REGEXP =
  /^(AVG|SUM|COUNT|MAX|MIN|GROUP_BY|group_by|groupBy|avg|sum|count|max|min)_(.*)$/i;

/**
 * @internal
 * Reads the records a strategy produced back into an `AggregateResponse`.
 *
 * Producing those records is an {@link AggregateStrategy}'s job - this only knows how the columns
 * are named, which is the contract the strategies share.
 */
export class AggregateBuilder {
  static async asyncConvertToAggregateResponse<Entity>(
    responsePromise: Promise<AggregateRecord[]>,
  ): Promise<AggregateResponse<Entity>[]> {
    return this.convertToAggregateResponse(await responsePromise);
  }

  static getAggregateAlias<Entity>(func: AggregateFunction, field: keyof Entity): string {
    return aggregateAlias(func, String(field));
  }

  static getGroupByAlias<Entity>(field: keyof Entity): string {
    return groupByAlias(String(field));
  }

  static convertToAggregateResponse<Entity>(
    rawAggregates: AggregateRecord[],
  ): AggregateResponse<Entity>[] {
    return rawAggregates.map((response) => {
      // Both the bucket (count/sum/.../groupBy) and the field inside it are decoded from column
      // names at runtime, so the response is assembled through an index signature and typed once
      // it is complete.
      const agg: Record<string, Record<string, unknown>> = {};
      const put = (bucket: string, field: string, value: unknown): void => {
        agg[bucket] = { ...agg[bucket], [field]: value };
      };

      // Handle Mongo-style grouped _id object (e.g. _id: { group_by_field: value })
      if (response._id && typeof response._id === 'object') {
        Object.entries(response._id as AggregateRecord).forEach(([key, value]) => {
          const match = /^(?:GROUP_BY|group_by|groupBy)_(.*)$/i.exec(key);
          if (match) {
            put('groupBy', match[1], value);
          }
        });
      }

      Object.keys(response).forEach((resultField) => {
        if (resultField === '_id') return;

        const matchResult = AGG_REGEXP.exec(resultField);
        if (!matchResult) {
          throw new Error('Unknown aggregate column encountered.');
        }
        const [matchedFunc, matchedFieldName] = matchResult.slice(1);
        const funcKey = matchedFunc.toLowerCase();
        // normalize to aggregate response keys: count, sum, avg, max, min, groupBy
        const bucket = funcKey === 'group_by' || funcKey === 'groupby' ? 'groupBy' : funcKey;
        put(bucket, matchedFieldName, response[resultField]);
      });

      return agg as unknown as AggregateResponse<Entity>;
    });
  }
}
