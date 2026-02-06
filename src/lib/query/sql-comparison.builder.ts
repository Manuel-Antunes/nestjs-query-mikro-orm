import type {
  CommonFieldComparisonBetweenType,
  FilterComparisonOperators,
} from '@nestjs-query/core';

/**
 * @internal
 */
export type EntityComparisonField<Entity, F extends keyof Entity> =
  | Entity[F]
  | Entity[F][]
  | CommonFieldComparisonBetweenType<Entity[F]>
  | true
  | false
  | null;

/**
 * @internal
 * Maps nestjs-query comparison operators to MikroORM operators.
 * This is a simplified version since MikroORM uses object-based filters.
 */
export class SQLComparisonBuilder<Entity> {
  /**
   * Maps a comparison operator to MikroORM filter format.
   *
   * @param field - the property in Entity to create the comparison for.
   * @param cmp - the FilterComparisonOperator (eq, neq, gt, etc...)
   * @param val - the value to compare to
   */
  build<F extends keyof Entity>(
    field: F,
    cmp: FilterComparisonOperators<Entity[F]>,
    val: EntityComparisonField<Entity, F>,
  ): Record<string, unknown> {
    const normalizedCmp = (cmp as string).toLowerCase();

    switch (normalizedCmp) {
      case 'eq':
        return { [field]: { $eq: val } };
      case 'neq':
        return { [field]: { $ne: val } };
      case 'gt':
        return { [field]: { $gt: val } };
      case 'gte':
        return { [field]: { $gte: val } };
      case 'lt':
        return { [field]: { $lt: val } };
      case 'lte':
        return { [field]: { $lte: val } };
      case 'like':
        return { [field]: { $like: val } };
      case 'notlike':
        return { [field]: { $not: { $like: val } } };
      case 'ilike':
        return { [field]: { $ilike: val } };
      case 'notilike':
        return { [field]: { $not: { $ilike: val } } };
      case 'is':
        return this.isComparison(field, val);
      case 'isnot':
        return this.isNotComparison(field, val);
      case 'in':
        this.checkNonEmptyArray(val);
        return { [field]: { $in: val } };
      case 'notin':
        this.checkNonEmptyArray(val);
        return { [field]: { $nin: val } };
      case 'between':
        return this.betweenComparison(field, val);
      case 'notbetween':
        return this.notBetweenComparison(field, val);
      default:
        throw new Error(`Unknown operator ${JSON.stringify(cmp)}`);
    }
  }

  private isComparison<F extends keyof Entity>(
    field: F,
    val: EntityComparisonField<Entity, F>,
  ): Record<string, unknown> {
    if (val === null) {
      return { [field]: { $eq: null } };
    }
    if (val === true) {
      return { [field]: { $eq: true } };
    }
    if (val === false) {
      return { [field]: { $eq: false } };
    }
    throw new Error(`Unexpected is operator param ${JSON.stringify(val)}`);
  }

  private isNotComparison<F extends keyof Entity>(
    field: F,
    val: EntityComparisonField<Entity, F>,
  ): Record<string, unknown> {
    if (val === null) {
      return { [field]: { $ne: null } };
    }
    if (val === true) {
      return { [field]: { $ne: true } };
    }
    if (val === false) {
      return { [field]: { $ne: false } };
    }
    throw new Error(`Unexpected isNot operator param ${JSON.stringify(val)}`);
  }

  private checkNonEmptyArray<F extends keyof Entity>(
    val: EntityComparisonField<Entity, F>,
  ): void {
    if (!Array.isArray(val)) {
      throw new Error(
        `Invalid in value expected an array got ${JSON.stringify(val)}`,
      );
    }
    if (!val.length) {
      throw new Error(
        `Invalid in value expected a non-empty array got ${JSON.stringify(val)}`,
      );
    }
  }

  private betweenComparison<F extends keyof Entity>(
    field: F,
    val: EntityComparisonField<Entity, F>,
  ): Record<string, unknown> {
    if (this.isBetweenVal(val)) {
      return {
        [field]: {
          $gte: val.lower,
          $lte: val.upper,
        },
      };
    }
    throw new Error(
      `Invalid value for between expected {lower: val, upper: val} got ${JSON.stringify(val)}`,
    );
  }

  private notBetweenComparison<F extends keyof Entity>(
    field: F,
    val: EntityComparisonField<Entity, F>,
  ): Record<string, unknown> {
    if (this.isBetweenVal(val)) {
      return {
        $or: [{ [field]: { $lt: val.lower } }, { [field]: { $gt: val.upper } }],
      };
    }
    throw new Error(
      `Invalid value for not between expected {lower: val, upper: val} got ${JSON.stringify(val)}`,
    );
  }

  private isBetweenVal<F extends keyof Entity>(
    val: EntityComparisonField<Entity, F>,
  ): val is CommonFieldComparisonBetweenType<Entity[F]> {
    return (
      val !== null &&
      typeof val === 'object' &&
      'lower' in val &&
      'upper' in val
    );
  }
}
