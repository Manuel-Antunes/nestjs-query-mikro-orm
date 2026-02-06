import type { FilterQuery } from '@mikro-orm/core';
import type {
  CommonFieldComparisonBetweenType,
  Filter,
  FilterComparisons,
  FilterFieldComparison,
} from '@nestjs-query/core';

/**
 * @internal
 * Builds a WHERE clause from a Filter for MikroORM.
 */
export class WhereBuilder<Entity> {
  /**
   * Builds a MikroORM FilterQuery from a nestjs-query Filter.
   * @param filter - the filter to build the WHERE clause from.
   */
  build(filter: Filter<Entity>): FilterQuery<Entity> {
    const { and, or } = filter;
    const conditions: FilterQuery<Entity>[] = [];

    // Handle AND conditions
    if (and && and.length) {
      const andConditions = and.map((f) => this.build(f as Filter<Entity>));
      conditions.push({ $and: andConditions } as FilterQuery<Entity>);
    }

    // Handle OR conditions
    if (or && or.length) {
      const orConditions = or.map((f) => this.build(f as Filter<Entity>));
      conditions.push({ $or: orConditions } as FilterQuery<Entity>);
    }

    // Handle field comparisons
    const fieldConditions = this.buildFieldComparisons(filter);
    if (Object.keys(fieldConditions).length > 0) {
      conditions.push(fieldConditions);
    }

    // Combine all conditions with $and if there are multiple
    if (conditions.length === 0) {
      return {} as FilterQuery<Entity>;
    }
    if (conditions.length === 1) {
      return conditions[0];
    }
    return { $and: conditions } as FilterQuery<Entity>;
  }

  /**
   * Known nestjs-query comparison operators
   */
  private readonly KNOWN_OPERATORS = new Set([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'notlike',
    'ilike',
    'notilike',
    'in',
    'notin',
    'is',
    'isnot',
    'between',
    'notbetween',
  ]);

  /**
   * Check if an object contains comparison operators (not nested relation filters)
   */
  private isComparisonObject(
    obj: unknown,
  ): obj is FilterFieldComparison<unknown> {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }
    const keys = Object.keys(obj);
    // If the object has any known operator keys, treat it as a comparison
    return keys.some((key) => this.KNOWN_OPERATORS.has(key.toLowerCase()));
  }

  /**
   * Creates field comparisons from a filter. This method will ignore and/or properties.
   * @param filter - the filter with fields to create comparisons for.
   */
  private buildFieldComparisons(filter: Filter<Entity>): FilterQuery<Entity> {
    const result: Record<string, unknown> = {};

    Object.keys(filter).forEach((field) => {
      if (field !== 'and' && field !== 'or') {
        const comparison = (filter as FilterComparisons<Entity>)[
          field as keyof FilterComparisons<Entity>
        ] as FilterFieldComparison<unknown>;

        if (comparison) {
          // Check if this is a nested relation filter (object without known operators)
          if (
            typeof comparison === 'object' &&
            !this.isComparisonObject(comparison)
          ) {
            // This is a nested relation filter - recursively build it
            result[field] = this.build(comparison as unknown as Filter<Entity>);
          } else {
            result[field] = this.buildComparison(comparison);
          }
        }
      }
    });

    return result as FilterQuery<Entity>;
  }

  /**
   * Builds a MikroORM comparison from a nestjs-query FilterFieldComparison.
   * @param comparison - the comparison to convert.
   */
  private buildComparison<T>(
    comparison: FilterFieldComparison<T>,
  ): Record<string, unknown> {
    const conditions: Record<string, unknown> = {};

    const operators = Object.keys(
      comparison,
    ) as (keyof FilterFieldComparison<T>)[];

    for (const operator of operators) {
      const value = comparison[operator];
      const mikroOrmOp = this.mapOperator(operator as string, value);
      Object.assign(conditions, mikroOrmOp);
    }

    // If there are multiple conditions, combine with $and
    if (Object.keys(conditions).length === 1) {
      return conditions;
    }

    return conditions;
  }

  /**
   * Maps a nestjs-query operator to a MikroORM operator.
   * @param operator - the nestjs-query operator.
   * @param value - the value to compare.
   */
  private mapOperator(
    operator: string,
    value: unknown,
  ): Record<string, unknown> {
    const normalizedOp = operator.toLowerCase();

    switch (normalizedOp) {
      case 'eq':
        return { $eq: value };
      case 'neq':
        return { $ne: value };
      case 'gt':
        return { $gt: value };
      case 'gte':
        return { $gte: value };
      case 'lt':
        return { $lt: value };
      case 'lte':
        return { $lte: value };
      case 'like':
        return { $like: value };
      case 'notlike':
        // MikroORM doesn't have a $nlike operator, but $not can be used at the field level
        // However, for relation filtering, this syntax may not work
        // Use $re with regex negation if needed, or return as $not: $like
        // Actually, SQLite supports NOT LIKE directly, so we'll use a raw approach
        return { $not: { $like: value } };
      case 'ilike':
        return { $ilike: value };
      case 'notilike':
        return { $not: { $ilike: value } };
      case 'in':
        return { $in: value };
      case 'notin':
        return { $nin: value };
      case 'is':
        if (value === null) {
          return { $eq: null };
        }
        if (value === true) {
          return { $eq: true };
        }
        if (value === false) {
          return { $eq: false };
        }
        throw new Error(
          `Unexpected is operator param ${JSON.stringify(value)}`,
        );
      case 'isnot':
        if (value === null) {
          return { $ne: null };
        }
        if (value === true) {
          return { $ne: true };
        }
        if (value === false) {
          return { $ne: false };
        }
        throw new Error(
          `Unexpected isNot operator param ${JSON.stringify(value)}`,
        );
      case 'between':
        if (this.isBetweenValue(value)) {
          return { $gte: value.lower, $lte: value.upper };
        }
        throw new Error(
          `Invalid value for between expected {lower: val, upper: val} got ${JSON.stringify(value)}`,
        );
      case 'notbetween':
        if (this.isBetweenValue(value)) {
          return {
            $or: [{ $lt: value.lower }, { $gt: value.upper }],
          };
        }
        throw new Error(
          `Invalid value for not between expected {lower: val, upper: val} got ${JSON.stringify(value)}`,
        );
      default:
        throw new Error(`Unknown operator ${operator}`);
    }
  }

  private isBetweenValue(
    val: unknown,
  ): val is CommonFieldComparisonBetweenType<unknown> {
    return (
      val !== null &&
      typeof val === 'object' &&
      'lower' in val &&
      'upper' in val
    );
  }
}
