import type { EntityMetadata } from '@mikro-orm/core';
import type { QueryBuilder } from './types';
import type { AggregateQuery, AggregateResponse } from '@nestjs-query/core';
import { raw } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';

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
    const aggs: [AggregateFuncs, (keyof Entity)[] | undefined][] = [
      [AggregateFuncs.COUNT, aggregate.count],
      [AggregateFuncs.SUM, aggregate.sum],
      [AggregateFuncs.AVG, aggregate.avg],
      [AggregateFuncs.MAX, aggregate.max],
      [AggregateFuncs.MIN, aggregate.min],
    ];

    const groupBySelects: [string, string][] = (aggregate.groupBy ?? []).map((f) => {
      const col = alias ? `\`${alias}\`.\`${String(f)}\`` : `\`${String(f)}\``;
      return [col, AggregateBuilder.getGroupByAlias(f)];
    });

    const funcSelects: [string, string][] = [];
    aggs.forEach(([func, fields]) => {
      const aliases = (fields ?? []).map((f) => {
        const col = alias ? `\`${alias}\`.\`${String(f)}\`` : `\`${String(f)}\``;
        return [`${func}(${col})`, AggregateBuilder.getAggregateAlias(func, f)];
      });
      funcSelects.push(...(aliases as [string, string][]));
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
    return (query.groupBy ?? []).map((f) => this.getGroupByAlias(f));
  }

  private static getAggregateFuncSelects<Entity>(query: AggregateQuery<Entity>): string[] {
    const aggs: [AggregateFuncs, (keyof Entity)[] | undefined][] = [
      [AggregateFuncs.COUNT, query.count],
      [AggregateFuncs.SUM, query.sum],
      [AggregateFuncs.AVG, query.avg],
      [AggregateFuncs.MAX, query.max],
      [AggregateFuncs.MIN, query.min],
    ];
    return aggs.reduce((cols, [func, fields]) => {
      const aliases = (fields ?? []).map((f) => this.getAggregateAlias(func, f));
      return [...cols, ...aliases];
    }, [] as string[]);
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
      const agg: AggregateResponse<Entity> = {} as AggregateResponse<Entity>;

      // Handle Mongo-style grouped _id object (e.g. _id: { group_by_field: value })
      if (response._id && typeof response._id === 'object') {
        const idObj = response._id as Record<string, unknown>;
        Object.keys(idObj).forEach((k) => {
          const m = /^(?:GROUP_BY|group_by|groupBy)_(.*)$/i.exec(k);
          if (m) {
            const field = m[1] as keyof Entity;
            agg.groupBy = { ...(agg.groupBy as Record<string, unknown>), [field]: idObj[k] } as any;
          }
        });
      }

      Object.keys(response).forEach((resultField) => {
        if (resultField === '_id') return;

        const matchResult = AGG_REGEXP.exec(resultField);
        if (!matchResult) {
          throw new Error('Unknown aggregate column encountered.');
        }
        const matchedFunc = matchResult[1];
        const matchedFieldName = matchResult[2];
        const funcKey = matchedFunc.toLowerCase();
        // normalize to aggregate response keys: count, sum, avg, max, min
        const aggFunc = (
          funcKey === 'group_by' || funcKey === 'groupby' ? 'groupBy' : funcKey
        ) as keyof AggregateResponse<Entity>;
        if (aggFunc === 'groupBy') {
          // If group_by leaked into top-level, set it on groupBy
          agg.groupBy = {
            ...(agg.groupBy as Record<string, unknown>),
            [matchedFieldName]: response[resultField],
          } as any;
          return;
        }

        const fieldName = matchedFieldName as keyof Entity;
        agg[aggFunc] = {
          ...(agg[aggFunc] as Record<string, unknown>),
          [fieldName]: response[resultField],
        } as any;
      });

      return agg;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: EntityMetadata<Entity> | undefined = (qb as any).mainAlias?.metadata;

    const selects = [
      ...this.createGroupBySelect(aggregate.groupBy, alias, metadata),
      ...this.createAggSelect(AggregateFuncs.COUNT, aggregate.count, alias, metadata),
      ...this.createAggSelect(AggregateFuncs.SUM, aggregate.sum, alias, metadata),
      ...this.createAggSelect(AggregateFuncs.AVG, aggregate.avg, alias, metadata),
      ...this.createAggSelect(AggregateFuncs.MAX, aggregate.max, alias, metadata),
      ...this.createAggSelect(AggregateFuncs.MIN, aggregate.min, alias, metadata),
    ];
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
    fields?: (keyof Entity)[],
    alias?: string,
    metadata?: EntityMetadata<Entity>,
  ): [string, string][] {
    if (!fields) {
      return [];
    }
    return fields.map((field) => {
      // Get the actual database column name from metadata
      const columnName = metadata
        ? this.getColumnName(metadata, field as string)
        : (field as string);
      const col = alias ? `\`${alias}\`.\`${columnName}\`` : `\`${columnName}\``;
      return [`${func}(${col})`, AggregateBuilder.getAggregateAlias(func, field)];
    });
  }

  private createGroupBySelect(
    fields?: (keyof Entity)[],
    alias?: string,
    metadata?: EntityMetadata<Entity>,
  ): [string, string][] {
    if (!fields) {
      return [];
    }
    return fields.map((field) => {
      // Get the actual database column name from metadata
      const columnName = metadata
        ? this.getColumnName(metadata, field as string)
        : (field as string);
      const col = alias ? `\`${alias}\`.\`${columnName}\`` : `\`${columnName}\``;
      return [`${col}`, AggregateBuilder.getGroupByAlias(field)];
    });
  }
}
