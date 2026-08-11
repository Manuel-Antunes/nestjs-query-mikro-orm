import type { EntityManager } from '@mikro-orm/core';
import { raw } from '@mikro-orm/core';

import type { AggregateRecord, AggregateRequest, AggregateStrategy } from './aggregate.strategy';
import {
  aggregateAlias,
  aggregateFunctionFields,
  aggregateGroupByFields,
  columnNameOf,
  groupByAlias,
} from './aggregate.strategy';

/**
 * The slice of `SqlEntityManager` this strategy needs.
 *
 * Declared structurally so the package does not have to depend on `@mikro-orm/sql` at all: the
 * dependency is the caller's, and it is what decides whether this strategy is usable.
 */
interface SqlCapableEntityManager {
  createQueryBuilder(entityName: unknown): SqlQueryBuilder;
}

interface SqlQueryBuilder {
  select(fields: unknown[]): SqlQueryBuilder;
  where(cond: unknown): SqlQueryBuilder;
  groupBy(fields: unknown[]): SqlQueryBuilder;
  execute(method: 'all', mapResults: boolean): Promise<AggregateRecord[]>;
}

/**
 * Computes aggregates with a `GROUP BY` on the database.
 *
 * Ships for the SQL drivers MikroORM supports (PostgreSQL, MySQL, MariaDB, MSSQL, SQLite/libSQL).
 * Unlike the in-memory default, only the grouped rows cross the wire.
 *
 * @example
 * ```ts
 * import { SqlAggregateStrategy } from 'nestjs-query-mikro-orm/sql'
 *
 * new TodoItemService(repo, { aggregateStrategy: new SqlAggregateStrategy() })
 * ```
 *
 * Two behaviours follow the database rather than JavaScript, by design - the point of pushing the
 * work down is to let the database answer:
 *
 * - `MAX`/`MIN` over text order by the column's collation, so a case-insensitive collation orders
 *   differently than the in-memory reduction, which compares by UTF-16 code unit.
 * - `AVG` over an integer column truncates on the databases that keep integer arithmetic.
 */
export class SqlAggregateStrategy implements AggregateStrategy {
  async execute<Entity extends object>(
    request: AggregateRequest<Entity>,
  ): Promise<AggregateRecord[]> {
    const { em, meta, where } = request;
    // checked before anything else touches the EntityManager, so a misconfigured strategy reports
    // itself instead of failing on whichever member it happened to reach first
    const queryBuilderFor = this.queryBuilderFactory(em);
    const platform = em.getPlatform();
    const quote = (identifier: string) => platform.quoteIdentifier(identifier);
    const column = (property: string) => quote(columnNameOf(meta, property));

    const groupBy = aggregateGroupByFields(request);
    const selects = [
      ...groupBy.map((property) => raw(`${column(property)} as ${quote(groupByAlias(property))}`)),
      ...aggregateFunctionFields(request.aggregate).flatMap(([func, properties]) =>
        properties.map((property) =>
          raw(`${func}(${column(property)}) as ${quote(aggregateAlias(func, property))}`),
        ),
      ),
    ];

    if (selects.length === 0) {
      return [];
    }

    const qb = queryBuilderFor(meta.class);
    qb.select(selects);
    qb.where(where);
    if (groupBy.length > 0) {
      qb.groupBy(groupBy.map((property) => raw(column(property))));
    }

    // `mapResults: false` keeps the raw column aliases instead of folding them into the entity
    return qb.execute('all', false);
  }

  private queryBuilderFactory(em: EntityManager): (entityName: unknown) => SqlQueryBuilder {
    const candidate = em as unknown as Partial<SqlCapableEntityManager>;
    if (typeof candidate.createQueryBuilder !== 'function') {
      throw new Error(
        'SqlAggregateStrategy requires a SQL EntityManager (`createQueryBuilder` is missing). ' +
          'Use the default in-memory strategy, or the mongo one, for this driver.',
      );
    }
    return (entityName) => candidate.createQueryBuilder!(entityName);
  }
}
