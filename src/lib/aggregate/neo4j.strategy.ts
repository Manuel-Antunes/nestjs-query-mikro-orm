import type { EntityManager, EntityMetadata } from '@mikro-orm/core';

import type { AggregateRecord, AggregateRequest, AggregateStrategy } from './aggregate.strategy';
import {
  aggregateAlias,
  aggregateFunctionFields,
  aggregateGroupByFields,
  groupByAlias,
} from './aggregate.strategy';

/**
 * The slice of `Neo4jEntityManager` this strategy needs.
 *
 * Declared structurally so the package does not have to depend on `mikro-orm-neo4j` at all: the
 * dependency is the caller's, and it is what decides whether this strategy is usable.
 */
interface Neo4jCapableEntityManager {
  aggregate<T = AggregateRecord>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** A Cypher fragment and the parameters it refers to. */
interface CypherPredicate {
  cypher: string;
  params: Record<string, unknown>;
}

/**
 * Computes aggregates with a Cypher `RETURN` on Neo4j.
 *
 * Written against [`mikro-orm-neo4j`](https://www.npmjs.com/package/mikro-orm-neo4j). Unlike the
 * in-memory default, only the grouped rows cross the wire.
 *
 * @example
 * ```ts
 * import { Neo4jAggregateStrategy } from 'nestjs-query-mikro-orm/neo4j'
 *
 * new TodoItemService(repo, { aggregateStrategy: new Neo4jAggregateStrategy() })
 * ```
 *
 * Three things about Cypher shape the implementation:
 *
 * - **Grouping is implicit.** Cypher groups by whichever returned expressions are *not*
 *   aggregations, so a grouped query is just the grouped properties listed alongside the
 *   aggregate ones - there is no `GROUP BY` to emit.
 * - **Properties are addressed by their entity property name**, not by `fieldNames`. The driver
 *   stores nodes keyed on the property, so {@link columnNameOf} - which the SQL and MongoDB
 *   strategies use - would address a property that is not there.
 * - **There is no `LIKE`.** `like`/`ilike` become regular expression matches, with the SQL
 *   wildcards translated.
 */
export class Neo4jAggregateStrategy implements AggregateStrategy {
  async execute<Entity extends object>(
    request: AggregateRequest<Entity>,
  ): Promise<AggregateRecord[]> {
    const { em, meta, where } = request;

    const groupBy = aggregateGroupByFields(request);
    const returns = [
      ...groupBy.map(
        (property) => `${this.property(property)} AS ${this.alias(groupByAlias(property))}`,
      ),
      ...aggregateFunctionFields(request.aggregate).flatMap(([func, properties]) =>
        properties.map(
          (property) =>
            `${func.toLowerCase()}(${this.property(property)}) AS ` +
            this.alias(aggregateAlias(func, property)),
        ),
      ),
    ];

    if (returns.length === 0) {
      return [];
    }

    const predicate = this.toPredicate(where as Record<string, unknown>);
    const cypher = [
      `MATCH (${NODE}:${this.label(meta)})`,
      predicate.cypher ? `WHERE ${predicate.cypher}` : '',
      `RETURN ${returns.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n');

    return this.aggregateOn(em, cypher, predicate.params);
  }

  /** The node label the entity is stored under. */
  private label<Entity extends object>(meta: EntityMetadata<Entity>): string {
    return this.escape(meta.collection ?? meta.className);
  }

  /** A property read off the matched node. */
  private property(property: string): string {
    return `${NODE}.${this.escape(property)}`;
  }

  /** A returned column name. */
  private alias(alias: string): string {
    return this.escape(alias);
  }

  private escape(token: string): string {
    return `\`${token.replace(/`/g, '``')}\``;
  }

  /**
   * Translates a filter into a Cypher predicate.
   *
   * The filters reaching a strategy are the ones this package's `WhereBuilder` produces, so the
   * vocabulary is small and known. Anything outside it throws rather than being dropped: a filter
   * that silently stops narrowing turns an aggregate into a confidently wrong number.
   */
  private toPredicate(where: Record<string, unknown> | undefined): CypherPredicate {
    const params: Record<string, unknown> = {};
    const bind = (value: unknown): string => {
      const name = `p${Object.keys(params).length}`;
      params[name] = value;
      return `$${name}`;
    };

    const cypher = this.conditions(where, bind).join(' AND ');
    return { cypher, params };
  }

  private conditions(
    where: Record<string, unknown> | undefined,
    bind: (value: unknown) => string,
  ): string[] {
    if (!where) {
      return [];
    }

    return Object.entries(where).flatMap(([key, value]) => {
      if (key === '$and' || key === '$or') {
        const parts = (value as Record<string, unknown>[])
          .map((branch) => this.conditions(branch, bind).join(' AND '))
          .filter(Boolean);
        if (parts.length === 0) {
          return [];
        }
        return [`(${parts.join(key === '$and' ? ' AND ' : ' OR ')})`];
      }

      if (key.startsWith('$')) {
        throw new Error(`Neo4jAggregateStrategy cannot translate the operator ${key}.`);
      }

      return [this.comparison(this.property(key), value, bind)];
    });
  }

  private comparison(property: string, value: unknown, bind: (value: unknown) => string): string {
    if (value === null) {
      return `${property} IS NULL`;
    }

    if (typeof value !== 'object' || value instanceof Date || Array.isArray(value)) {
      // MikroORM's shorthand for equality
      return `${property} = ${bind(value)}`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(`Neo4jAggregateStrategy cannot translate an empty comparison.`);
    }
    if (!entries.every(([operator]) => operator.startsWith('$'))) {
      // a nested object without operators is a filter reaching into a relation, which on a graph
      // means traversing an edge rather than reading a property
      throw new Error(
        'Neo4jAggregateStrategy cannot aggregate through a relation filter. Use the default ' +
          'in-memory strategy for this query.',
      );
    }

    return entries
      .map(([operator, operand]) => this.operator(property, operator, operand, bind))
      .join(' AND ');
  }

  private operator(
    property: string,
    operator: string,
    value: unknown,
    bind: (value: unknown) => string,
  ): string {
    switch (operator) {
      case '$eq':
        return value === null ? `${property} IS NULL` : `${property} = ${bind(value)}`;
      case '$ne':
        return value === null ? `${property} IS NOT NULL` : `${property} <> ${bind(value)}`;
      case '$gt':
        return `${property} > ${bind(value)}`;
      case '$gte':
        return `${property} >= ${bind(value)}`;
      case '$lt':
        return `${property} < ${bind(value)}`;
      case '$lte':
        return `${property} <= ${bind(value)}`;
      case '$in':
        return `${property} IN ${bind(value)}`;
      case '$nin':
        return `NOT ${property} IN ${bind(value)}`;
      case '$like':
        return `${property} =~ ${bind(likeToRegex(String(value)))}`;
      case '$ilike':
        return `${property} =~ ${bind(`(?i)${likeToRegex(String(value))}`)}`;
      case '$not':
        return `NOT (${this.comparison(property, value, bind)})`;
      default:
        throw new Error(`Neo4jAggregateStrategy cannot translate the operator ${operator}.`);
    }
  }

  private async aggregateOn(
    em: EntityManager,
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<AggregateRecord[]> {
    const candidate = em as unknown as Partial<Neo4jCapableEntityManager>;
    if (typeof candidate.aggregate !== 'function') {
      throw new Error(
        'Neo4jAggregateStrategy requires the Neo4j EntityManager (`aggregate` is missing). ' +
          'Use the default in-memory strategy for this driver.',
      );
    }
    return candidate.aggregate<AggregateRecord>(cypher, params);
  }
}

/** The variable the matched node is bound to. */
const NODE = 'n';

/**
 * Rewrites a SQL `LIKE` pattern as the regular expression Cypher's `=~` expects.
 *
 * Everything that means something to a regex is escaped first, so only the two SQL wildcards keep
 * their meaning: `%` for any run of characters and `_` for exactly one.
 */
const likeToRegex = (pattern: string): string =>
  pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
