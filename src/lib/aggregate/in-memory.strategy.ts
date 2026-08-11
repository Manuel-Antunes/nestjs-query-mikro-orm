import type { FilterQuery } from '@mikro-orm/core';

import type { AggregateFunction, AggregateRecord, AggregateRequest } from './aggregate.strategy';
import {
  aggregateAlias,
  aggregateFunctionFields,
  aggregateGroupByFields,
  AggregateStrategy,
  groupByAlias,
} from './aggregate.strategy';

export interface InMemoryAggregateStrategyOpts {
  /**
   * How many rows the reduction is allowed to pull in before giving up.
   *
   * This strategy has to hold every matching row to compute an aggregate, so an unbounded filter
   * over a large table is a memory hazard rather than a slow query. Setting a ceiling turns that
   * into an error naming the strategy, instead of a process that dies. Unlimited by default, which
   * is the historical behaviour.
   */
  maxRows?: number;
}

/**
 * Computes aggregates by loading the matching rows and reducing them in JavaScript.
 *
 * This is the default because it is the only implementation that cannot be wrong about a backend:
 * it needs nothing from the driver beyond `find`. That generality is paid for one row at a time -
 * push the work into the database with `nestjs-query-mikro-orm/sql` or
 * `nestjs-query-mikro-orm/mongo` once the volume justifies it.
 */
export class InMemoryAggregateStrategy implements AggregateStrategy {
  private readonly maxRows: number;

  constructor(opts: InMemoryAggregateStrategyOpts = {}) {
    this.maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;
  }

  async execute<Entity extends object>(
    request: AggregateRequest<Entity>,
  ): Promise<AggregateRecord[]> {
    const { em, meta, where } = request;
    const rows = (await em.find(meta.class, where as FilterQuery<NoInfer<Entity>>, {
      limit: Number.isFinite(this.maxRows) ? this.maxRows + 1 : undefined,
    })) as unknown[];

    if (rows.length > this.maxRows) {
      throw new Error(
        `InMemoryAggregateStrategy refused to aggregate more than ${this.maxRows} rows of ` +
          `${meta.className}. Raise \`maxRows\`, narrow the filter, or install one of the ` +
          `database-side strategies.`,
      );
    }

    return this.reduce(rows, request);
  }

  /**
   * Reduces rows that are already in memory.
   *
   * Exposed because the relation loader has the rows in hand already - it fetched them in one
   * batched query - and would otherwise re-read them just to aggregate.
   */
  reduce<Entity extends object>(
    rows: unknown[],
    request: Pick<AggregateRequest<Entity>, 'aggregate' | 'additionalGroupBy'>,
  ): AggregateRecord[] {
    const groupBy = aggregateGroupByFields(request);

    if (groupBy.length === 0) {
      return [this.reduceGroup(rows, request)];
    }

    // Group by the values of every grouped property, keeping the values around so they can be
    // reported back without parsing them out of the group key again.
    const groups = new Map<string, { values: unknown[]; rows: unknown[] }>();
    rows.forEach((row) => {
      const values = groupBy.map((property) => (row as AggregateRecord)[property]);
      const key = JSON.stringify(values);
      const group = groups.get(key) ?? { values, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    });

    return Array.from(groups.values()).map(({ values, rows: groupRows }) => {
      const seed: AggregateRecord = {};
      groupBy.forEach((property, i) => {
        seed[groupByAlias(property)] = values[i];
      });
      return this.reduceGroup(groupRows, request, seed);
    });
  }

  private reduceGroup<Entity extends object>(
    rows: unknown[],
    request: Pick<AggregateRequest<Entity>, 'aggregate'>,
    seed: AggregateRecord = {},
  ): AggregateRecord {
    const record: AggregateRecord = { ...seed };

    aggregateFunctionFields(request.aggregate).forEach(([func, properties]) => {
      properties.forEach((property) => this.apply(rows, record, func, property));
    });

    return record;
  }

  private apply(
    rows: unknown[],
    record: AggregateRecord,
    func: AggregateFunction,
    property: string,
  ): void {
    const alias = aggregateAlias(func, property);
    const values = rows
      .map((row) => (row as AggregateRecord)[property])
      .filter((value) => value !== undefined && value !== null);

    if (func === 'COUNT') {
      record[alias] = values.length;
      return;
    }

    if (values.length === 0) {
      record[alias] = null;
      return;
    }

    const toNumbers = () => values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));

    if (func === 'SUM' || func === 'AVG') {
      // SUM and AVG only for numeric values
      const nums = toNumbers().filter((n) => !Number.isNaN(n));
      const sum = nums.reduce((total: number, v: number) => total + v, 0);
      record[alias] = func === 'SUM' ? sum : nums.length ? sum / nums.length : null;
      return;
    }

    const isNumeric = (value: unknown) => typeof value === 'number' || value instanceof Date;
    if (values.every(isNumeric)) {
      const nums = toNumbers();
      const picked = func === 'MAX' ? Math.max(...nums) : Math.min(...nums);
      // hand back the original value so a date stays a date rather than becoming its epoch
      record[alias] = values[nums.indexOf(picked)];
      return;
    }

    record[alias] = values.reduce((a, b) => {
      const isGreater = String(a) > String(b);
      return (func === 'MAX') === isGreater ? a : b;
    });
  }
}
