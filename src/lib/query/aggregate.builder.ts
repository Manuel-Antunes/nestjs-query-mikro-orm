import type { EntityMetadata } from '@mikro-orm/core';
import { raw } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';
import type {
  AggregateQuery,
  AggregateQueryField,
  AggregateQueryGroupByField,
  AggregateResponse,
} from '@ptc-org/nestjs-query-core';
import type { QueryBuilder } from './types';

enum AggregateFuncs {
  AVG = 'AVG',
  SUM = 'SUM',
  COUNT = 'COUNT',
  MAX = 'MAX',
  MIN = 'MIN',
}

// Matches aggregate column prefixes in a case-insensitive way and multiple naming styles
const AGG_REGEXP =
  /^(AVG|SUM|COUNT|MAX|MIN|GROUP_BY|group_by|groupBy|avg|sum|count|max|min)_(.*)$/i;

/**
 * @internal
 * Builds aggregate queries for MikroORM.
 */
export class AggregateBuilder<Entity extends object> {
  static buildSelectExpressions<Entity>(
    aggregate: AggregateQuery<Entity>,
    alias?: string,
  ): [string, string][] {
    const aggs = AggregateBuilder.toFunctionEntries(aggregate);

    const groupBySelects: [string, string][] = (aggregate.groupBy ?? []).map(({ field }) => {
      const col = alias ? `\`${alias}\`.\`${String(field)}\`` : `\`${String(field)}\``;
      return [col, AggregateBuilder.getGroupByAlias<Entity>(field)];
    });

    const funcSelects: [string, string][] = [];
    // Only create selects for aggregate functions that actually have fields
    aggs.forEach(([func, fields]) => {
      if (!fields || fields.length === 0) return;
      fields.forEach(({ field }) => {
        const col = alias ? `\`${alias}\`.\`${String(field)}\`` : `\`${String(field)}\``;
        funcSelects.push([
          `${func}(${col})`,
          AggregateBuilder.getAggregateAlias<Entity>(func, field),
        ]);
      });
    });

    const selects = [...groupBySelects, ...funcSelects];
    if (!selects.length) {
      throw new BadRequestException('No aggregate fields found.');
    }
    return selects;
  }
  static async asyncConvertToAggregateResponse<Entity>(
    responsePromise: Promise<Record<string, unknown>[]>,
  ): Promise<AggregateResponse<Entity>[]> {
    const aggResponse = await responsePromise;
    return this.convertToAggregateResponse(aggResponse);
  }

  static getAggregateSelects<Entity>(query: AggregateQuery<Entity>): string[] {
    return [...this.getAggregateGroupBySelects(query), ...this.getAggregateFuncSelects(query)];
  }

  private static getAggregateGroupBySelects<Entity>(query: AggregateQuery<Entity>): string[] {
    return (query.groupBy ?? []).map(({ field }) => this.getGroupByAlias<Entity>(field));
  }

  private static getAggregateFuncSelects<Entity>(query: AggregateQuery<Entity>): string[] {
    return this.toFunctionEntries(query).reduce((cols, [func, fields]) => {
      if (!fields || fields.length === 0) return cols;
      return [...cols, ...fields.map(({ field }) => this.getAggregateAlias<Entity>(func, field))];
    }, [] as string[]);
  }

  /**
   * Pairs every aggregate function with the fields it was requested for.
   *
   * Each entry of an `AggregateQuery` is a `{ field, args }` record rather than a bare property
   * name, so the field always has to be read off the record - stringifying the record itself is
   * what produced `COUNT_[object Object]` column aliases.
   */
  private static toFunctionEntries<Entity>(
    query: AggregateQuery<Entity>,
  ): [AggregateFuncs, AggregateQueryField<Entity>[] | undefined][] {
    return [
      [AggregateFuncs.COUNT, query.count],
      [AggregateFuncs.SUM, query.sum],
      [AggregateFuncs.AVG, query.avg],
      [AggregateFuncs.MAX, query.max],
      [AggregateFuncs.MIN, query.min],
    ];
  }

  static getAggregateAlias<Entity>(func: AggregateFuncs, field: keyof Entity): string {
    return `${func}_${field as string}`;
  }

  static getGroupByAlias<Entity>(field: keyof Entity): string {
    return `GROUP_BY_${field as string}`;
  }

  static convertToAggregateResponse<Entity>(
    rawAggregates: Record<string, unknown>[],
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
        Object.entries(response._id as Record<string, unknown>).forEach(([key, value]) => {
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

  /**
   * Gets the actual database column name for a property from entity metadata.
   * @param metadata - the entity metadata
   * @param propertyName - the property name
   * @returns the database column name
   */
  private getColumnName(metadata: EntityMetadata<Entity>, propertyName: string): string {
    const prop = metadata.properties[propertyName as keyof (typeof metadata)['properties']];
    if (prop && prop.fieldNames && prop.fieldNames.length > 0) {
      return prop.fieldNames[0];
    }
    return propertyName; // fallback to property name if not found
  }

  /**
   * Builds aggregate SELECT clause for MikroORM QueryBuilder.
   * @param qb - the MikroORM QueryBuilder
   * @param aggregate - the aggregates to select.
   * @param alias - optional alias to use to qualify an identifier
   */
  build<Qb extends QueryBuilder<Entity>>(
    qb: Qb,
    aggregate: AggregateQuery<Entity>,
    alias?: string,
  ): Qb {
    // Get entity metadata for column name resolution via the qb's internal helper
    const metadata = (qb as { mainAlias?: { metadata?: EntityMetadata<Entity> } }).mainAlias
      ?.metadata;

    const selects: [string, string][] = [];
    // Group by selects
    selects.push(...this.createGroupBySelect(aggregate.groupBy, alias, metadata));

    // Only add aggregate selects for functions that were requested
    AggregateBuilder.toFunctionEntries(aggregate).forEach(([func, fields]) => {
      if (!fields || fields.length === 0) return;
      selects.push(...this.createAggSelect(func, fields, alias, metadata));
    });
    if (!selects.length) {
      throw new BadRequestException('No aggregate fields found.');
    }

    // Use MikroORM's raw() and addSelect() to avoid finalizing the QueryBuilder
    selects.forEach(([selectExpr, selectAlias]) => {
      qb.addSelect!(raw(`${selectExpr} as "${selectAlias}"`));
    });

    return qb;
  }

  private createAggSelect(
    func: AggregateFuncs,
    fields?: AggregateQueryField<Entity>[],
    alias?: string,
    metadata?: EntityMetadata<Entity>,
  ): [string, string][] {
    return (fields ?? []).map(({ field }) => [
      `${func}(${this.quoteColumn(field, alias, metadata)})`,
      AggregateBuilder.getAggregateAlias<Entity>(func, field),
    ]);
  }

  private createGroupBySelect(
    fields?: AggregateQueryGroupByField<Entity>[],
    alias?: string,
    metadata?: EntityMetadata<Entity>,
  ): [string, string][] {
    return (fields ?? []).map(({ field }) => [
      this.quoteColumn(field, alias, metadata),
      AggregateBuilder.getGroupByAlias<Entity>(field),
    ]);
  }

  /**
   * Renders a property as the quoted database column it maps to, qualified by the alias when one
   * is in play.
   */
  private quoteColumn(
    field: keyof Entity,
    alias?: string,
    metadata?: EntityMetadata<Entity>,
  ): string {
    const columnName = metadata ? this.getColumnName(metadata, String(field)) : String(field);
    return alias ? `\`${alias}\`.\`${columnName}\`` : `\`${columnName}\``;
  }

  /**
   * Computes an aggregate over rows that are already in memory.
   *
   * Used by the database-agnostic paths, which fetch the matching rows and reduce them here rather
   * than pushing a `GROUP BY` down to the driver. The records come back keyed by the same aliases
   * {@link getAggregateAlias} and {@link getGroupByAlias} give the SQL columns, so both paths can
   * be handed to {@link convertToAggregateResponse} unchanged.
   */
  static computeAggregates<Entity>(
    rows: unknown[],
    aggregate: AggregateQuery<Entity>,
  ): Record<string, unknown>[] {
    const groupBy = aggregate.groupBy ?? [];

    if (groupBy.length === 0) {
      return [this.computeAggregateRecord(rows, aggregate)];
    }

    // Group the rows by the values of every groupBy field, keeping the values around so they can
    // be reported back without having to parse them out of the group key again.
    const groups = new Map<string, { values: unknown[]; rows: unknown[] }>();
    rows.forEach((row) => {
      const values = groupBy.map(({ field }) => (row as Record<string, unknown>)[String(field)]);
      const key = JSON.stringify(values);
      const group = groups.get(key) ?? { values, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    });

    return Array.from(groups.values()).map(({ values, rows: groupRows }) => {
      const seed: Record<string, unknown> = {};
      groupBy.forEach(({ field }, i) => {
        const value = values[i];
        // Normalize boolean group values to 0/1 to match SQL behavior
        seed[this.getGroupByAlias<Entity>(field)] =
          typeof value === 'boolean' ? (value ? 1 : 0) : value;
      });
      return this.computeAggregateRecord(groupRows, aggregate, seed);
    });
  }

  private static computeAggregateRecord<Entity>(
    rows: unknown[],
    aggregate: AggregateQuery<Entity>,
    seed: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...seed };

    this.toFunctionEntries(aggregate).forEach(([func, fields]) => {
      (fields ?? []).forEach(({ field }) =>
        this.computeAggregateField(rows, out, func, String(field)),
      );
    });

    return out;
  }

  private static computeAggregateField(
    rows: unknown[],
    out: Record<string, unknown>,
    func: AggregateFuncs,
    field: string,
  ): void {
    const aggKey = `${func}_${field}`;
    const values = rows
      .map((row) => (row as Record<string, unknown>)[field])
      .filter((value) => value !== undefined && value !== null);

    if (func === AggregateFuncs.COUNT) {
      out[aggKey] = values.length;
      return;
    }

    if (values.length === 0) {
      out[aggKey] = null;
      return;
    }

    const isNumeric = (value: unknown) => typeof value === 'number' || value instanceof Date;
    const toNumbers = () => values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));

    if (func === AggregateFuncs.SUM || func === AggregateFuncs.AVG) {
      // SUM and AVG only for numeric values
      const nums = toNumbers().filter((n) => !Number.isNaN(n));
      const sum = nums.reduce((s: number, v: number) => s + v, 0);
      out[aggKey] = func === AggregateFuncs.SUM ? sum : nums.length ? sum / nums.length : null;
      return;
    }

    if (values.every(isNumeric)) {
      const nums = toNumbers();
      out[aggKey] = func === AggregateFuncs.MAX ? Math.max(...nums) : Math.min(...nums);
      return;
    }

    out[aggKey] = values.reduce((a, b) => {
      const isGreater = String(a) > String(b);
      return (func === AggregateFuncs.MAX) === isGreater ? a : b;
    });
  }
}
