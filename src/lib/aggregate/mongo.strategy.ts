import type { EntityManager } from '@mikro-orm/core';

import type { AggregateRecord, AggregateRequest, AggregateStrategy } from './aggregate.strategy';
import {
  aggregateAlias,
  aggregateFunctionFields,
  aggregateGroupByFields,
  columnNameOf,
  groupByAlias,
} from './aggregate.strategy';

/**
 * The slice of `MongoEntityManager` this strategy needs.
 *
 * Declared structurally so the package does not have to depend on `@mikro-orm/mongodb` at all: the
 * dependency is the caller's, and it is what decides whether this strategy is usable.
 */
interface MongoCapableEntityManager {
  aggregate(entityName: unknown, pipeline: unknown[]): Promise<AggregateRecord[]>;
  getDriver(): Partial<MongoCapableDriver>;
}

interface MongoCapableDriver {
  /**
   * Rewrites a filter's property names into the field names stored in the collection, `id` to
   * `_id` included. `em.aggregate` hands the pipeline to the driver untouched, so a `$match` that
   * skipped this would silently match nothing whenever a property and its column differ.
   */
  renameFields<T extends object>(entityName: unknown, data: T, dotPaths?: boolean): T;
}

/**
 * Computes aggregates with a `$group` stage on MongoDB.
 *
 * Unlike the in-memory default, only the grouped documents cross the wire.
 *
 * @example
 * ```ts
 * import { MongoAggregateStrategy } from 'nestjs-query-mikro-orm/mongo'
 *
 * new TodoItemService(repo, { aggregateStrategy: new MongoAggregateStrategy() })
 * ```
 *
 * `MAX`/`MIN` follow MongoDB's BSON comparison order, which sorts across types and is not the
 * UTF-16 code unit order the in-memory reduction uses for text.
 */
export class MongoAggregateStrategy implements AggregateStrategy {
  async execute<Entity extends object>(
    request: AggregateRequest<Entity>,
  ): Promise<AggregateRecord[]> {
    const { em, meta, where } = request;
    const field = (property: string) => `$${columnNameOf(meta, property)}`;

    const groupBy = aggregateGroupByFields(request);
    const group: AggregateRecord = {
      // `null` is the pipeline's way of saying "one group for everything"
      _id:
        groupBy.length === 0
          ? null
          : Object.fromEntries(
              groupBy.map((property) => [groupByAlias(property), field(property)]),
            ),
    };

    aggregateFunctionFields(request.aggregate).forEach(([func, properties]) => {
      properties.forEach((property) => {
        group[aggregateAlias(func, property)] = this.accumulator(func, field(property));
      });
    });

    if (Object.keys(group).length === 1) {
      return [];
    }

    const match = this.toFieldNames(em, meta.class, where as object);
    return this.aggregateOn(em, meta.class, [{ $match: match }, { $group: group }]);
  }

  private accumulator(func: string, field: string): AggregateRecord {
    if (func !== 'COUNT') {
      return { [`$${func.toLowerCase()}`]: field };
    }

    // SQL's COUNT(column) skips nulls; `$sum: 1` would count the whole group, so missing and null
    // documents are excluded explicitly to keep the two backends answering the same question.
    return {
      $sum: { $cond: [{ $eq: [{ $ifNull: [field, null] }, null] }, 0, 1] },
    };
  }

  private toFieldNames(em: EntityManager, entityName: unknown, where: object): object {
    const driver = (em as unknown as MongoCapableEntityManager).getDriver?.();
    return typeof driver?.renameFields === 'function'
      ? driver.renameFields(entityName, where, true)
      : where;
  }

  private async aggregateOn(
    em: EntityManager,
    entityName: unknown,
    pipeline: unknown[],
  ): Promise<AggregateRecord[]> {
    const candidate = em as unknown as Partial<MongoCapableEntityManager>;
    if (typeof candidate.aggregate !== 'function') {
      throw new Error(
        'MongoAggregateStrategy requires the MongoDB EntityManager (`aggregate` is missing). ' +
          'Use the default in-memory strategy, or the sql one, for this driver.',
      );
    }
    return candidate.aggregate(entityName, pipeline);
  }
}
