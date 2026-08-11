import type { EntityManager, EntityMetadata, FilterQuery } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';

/**
 * Everything a strategy needs to answer one aggregate question.
 *
 * Both call sites reduce to this shape: aggregating entities narrows to the query's filter, and
 * aggregating a relation narrows to the condition that ties the relation rows to their owner.
 */
export interface AggregateRequest<Entity extends object> {
  /** The EntityManager to run against. Already forked/scoped by the caller. */
  em: EntityManager;

  /**
   * Metadata for the entity being aggregated.
   *
   * Strategies need it to reach the database column behind a property (`prop.fieldNames[0]`), and
   * it saves every implementation from resolving the entity by name again.
   */
  meta: EntityMetadata<Entity>;

  /** The rows to aggregate over, already converted to MikroORM's filter shape. */
  where: FilterQuery<Entity>;

  /** The functions and fields requested. */
  aggregate: AggregateQuery<Entity>;

  /**
   * Extra properties to group by, on top of the ones in `aggregate.groupBy`.
   *
   * This is what lets a caller aggregate for many owners in a single round trip: it groups by the
   * owning key as well and splits the records afterwards. Records must carry these back under the
   * same `GROUP_BY_<property>` alias as a requested group-by.
   */
  additionalGroupBy?: string[];
}

/**
 * Computes aggregates for one backend.
 *
 * The default is {@link InMemoryAggregateStrategy}, which fetches the matching rows and reduces
 * them in JavaScript. It is correct against every driver MikroORM can talk to, at the cost of
 * loading each row. The optional strategies push the work into the database instead:
 *
 * - `nestjs-query-mikro-orm/sql` for the SQL drivers
 * - `nestjs-query-mikro-orm/mongo` for MongoDB
 *
 * Implement this to support a driver neither of those covers.
 *
 * @example
 * ```ts
 * export class Neo4jAggregateStrategy implements AggregateStrategy {
 *   async execute<Entity extends object>(
 *     request: AggregateRequest<Entity>,
 *   ): Promise<AggregateRecord[]> {
 *     // ...run the aggregation, then key each record the way `aggregateAlias`/`groupByAlias` do
 *   }
 * }
 * ```
 */
export interface AggregateStrategy {
  /**
   * Returns one record per group - or exactly one record when nothing is grouped.
   *
   * Records are keyed by the aliases {@link aggregateAlias} and {@link groupByAlias} produce, and
   * the values are whatever the backend returned: the caller coerces them to the types
   * `AggregateResponse` declares, so every strategy answers the same question the same way.
   */
  execute<Entity extends object>(request: AggregateRequest<Entity>): Promise<AggregateRecord[]>;
}

/**
 * One aggregated group, keyed by the column aliases the strategies agree on.
 *
 * MongoDB reports its grouped columns nested under `_id`, which is read back as well.
 */
export type AggregateRecord = Record<string, unknown>;

/** The aggregate functions a strategy has to understand. */
export const AGGREGATE_FUNCTIONS = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'] as const;

export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number];

/** The alias an aggregated column is reported under, e.g. `COUNT_id`. */
export const aggregateAlias = (func: AggregateFunction, property: string): string =>
  `${func}_${property}`;

/** The alias a grouped column is reported under, e.g. `GROUP_BY_status`. */
export const groupByAlias = (property: string): string => `GROUP_BY_${property}`;

/**
 * Pairs every aggregate function with the properties it was requested for.
 *
 * Each entry of an `AggregateQuery` is a `{ field, args }` record rather than a bare property
 * name, so the property always has to be read off the record.
 */
export const aggregateFunctionFields = <Entity>(
  aggregate: AggregateQuery<Entity>,
): [AggregateFunction, string[]][] =>
  (
    [
      ['COUNT', aggregate.count],
      ['SUM', aggregate.sum],
      ['AVG', aggregate.avg],
      ['MAX', aggregate.max],
      ['MIN', aggregate.min],
    ] as const
  ).map(([func, fields]) => [func, (fields ?? []).map(({ field }) => String(field))]);

/** The properties an aggregate groups by, request extras included. */
export const aggregateGroupByFields = <Entity extends object>(
  request: Pick<AggregateRequest<Entity>, 'aggregate' | 'additionalGroupBy'>,
): string[] => [
  ...(request.aggregate.groupBy ?? []).map(({ field }) => String(field)),
  ...(request.additionalGroupBy ?? []),
];

/**
 * The database column a property maps to, falling back to the property name.
 *
 * Strategies that speak to the database directly address columns, not properties - the two only
 * coincide when no naming strategy is in play.
 */
export const columnNameOf = <Entity extends object>(
  meta: EntityMetadata<Entity>,
  property: string,
): string => {
  const prop = meta.properties[property as keyof typeof meta.properties];
  return prop?.fieldNames?.[0] ?? property;
};
