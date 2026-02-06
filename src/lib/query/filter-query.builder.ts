import type { EntityMetadata, QBFilterQuery } from '@mikro-orm/core';
import type { EntityRepository, QueryBuilder } from '@mikro-orm/knex';
import type { AggregateQuery, Filter, Paging, Query, SortField } from '@nestjs-query/core';
import { getFilterFields } from '@nestjs-query/core';
import merge from 'lodash.merge';

import { AggregateBuilder } from './aggregate.builder';
import { WhereBuilder } from './where.builder';

/**
 * @internal
 *
 * Nested record type
 */
export interface NestedRecord<E = unknown> {
  [keys: string]: NestedRecord<E>;
}

/**
 * @internal
 *
 * Class that will convert a Query into a MikroORM Query Builder.
 */
export class FilterQueryBuilder<Entity extends object> {
  constructor(
    readonly repo: EntityRepository<Entity>,
    readonly whereBuilder: WhereBuilder<Entity> = new WhereBuilder<Entity>(),
    readonly aggregateBuilder: AggregateBuilder<Entity> = new AggregateBuilder<Entity>(),
  ) {}

  /**
   * Create a MikroORM QueryBuilder with `WHERE`, `ORDER BY` and `LIMIT/OFFSET` clauses.
   *
   * @param query - the query to apply.
   */
  select(query: Query<Entity>): QueryBuilder<Entity> {
    const alias = this.getEntityAlias();
    const qb = this.createQueryBuilder(alias);
    this.applyFilter(qb, query.filter, alias);
    this.applySorting(qb, query.sorting, alias);
    this.applyPaging(qb, query.paging);
    return qb;
  }

  selectById(
    id: string | number | (string | number)[],
    query: Query<Entity>,
  ): QueryBuilder<Entity> {
    const alias = this.getEntityAlias();
    const qb = this.createQueryBuilder(alias);
    const metadata = this.repo.getEntityManager().getMetadata().get(this.repo.getEntityName());
    const primaryKey = metadata.primaryKeys[0];

    if (Array.isArray(id)) {
      qb.where({ [primaryKey]: { $in: id } } as QBFilterQuery<Entity>);
    } else {
      qb.where({ [primaryKey]: id } as QBFilterQuery<Entity>);
    }

    this.applyFilter(qb, query.filter, alias);
    this.applySorting(qb, query.sorting, alias);
    this.applyPaging(qb, query.paging);
    return qb;
  }

  aggregate(query: Query<Entity>, aggregate: AggregateQuery<Entity>): QueryBuilder<Entity> {
    const alias = this.getEntityAlias();
    const qb = this.createQueryBuilder(alias);
    this.applyAggregate(qb, aggregate, alias);
    this.applyFilter(qb, query.filter, alias);
    this.applyAggregateSorting(qb, aggregate.groupBy, alias);
    this.applyGroupBy(qb, aggregate.groupBy, alias);
    return qb;
  }

  /**
   * Applies paging to a MikroORM query builder
   * @param qb - the MikroORM QueryBuilder
   * @param paging - the Paging options.
   */
  applyPaging<Q extends QueryBuilder<Entity>>(qb: Q, paging?: Paging): Q {
    if (!paging) {
      return qb;
    }

    if (paging.limit !== undefined) {
      qb.limit(paging.limit);
    }
    if (paging.offset !== undefined) {
      qb.offset(paging.offset);
    }

    return qb;
  }

  /**
   * Applies the aggregate selects from a Query to a MikroORM QueryBuilder.
   *
   * @param qb - the MikroORM QueryBuilder.
   * @param aggregate - the aggregates to select.
   * @param alias - optional alias to use to qualify an identifier
   */
  applyAggregate<Q extends QueryBuilder<Entity>>(
    qb: Q,
    aggregate: AggregateQuery<Entity>,
    alias?: string,
  ): Q {
    return this.aggregateBuilder.build(qb, aggregate, alias);
  }

  /**
   * Applies the filter from a Query to a MikroORM QueryBuilder.
   *
   * @param qb - the MikroORM QueryBuilder.
   * @param filter - the filter.
   * @param _alias - optional alias to use to qualify an identifier (unused in MikroORM)
   */
  applyFilter<Q extends QueryBuilder<Entity>>(qb: Q, filter?: Filter<Entity>, _alias?: string): Q {
    if (!filter) {
      return qb;
    }
    const mikroOrmFilter = this.whereBuilder.build(filter);
    return qb.andWhere(mikroOrmFilter as QBFilterQuery<Entity>) as Q;
  }

  /**
   * Applies the ORDER BY clause to a MikroORM QueryBuilder.
   * @param qb - the MikroORM QueryBuilder.
   * @param sorts - an array of SortFields to create the ORDER BY clause.
   * @param _alias - optional alias to use to qualify an identifier (unused in MikroORM)
   */
  applySorting<Q extends QueryBuilder<Entity>>(
    qb: Q,
    sorts?: SortField<Entity>[],
    _alias?: string,
  ): Q {
    if (!sorts || sorts.length === 0) {
      return qb;
    }

    const orderBy = sorts.reduce(
      (acc, { field, direction, nulls }) => {
        const order = direction === 'ASC' ? 'asc' : 'desc';
        let orderValue: string | object = order;

        if (nulls) {
          orderValue = `${order} ${nulls.toLowerCase().replace('_', ' ')}`;
        }

        return { ...acc, [field]: orderValue };
      },
      {} as Record<string, unknown>,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb.orderBy(orderBy as any) as Q;
  }

  applyGroupBy<Q extends QueryBuilder<Entity>>(
    qb: Q,
    groupBy?: (keyof Entity)[],
    _alias?: string,
  ): Q {
    if (!groupBy || groupBy.length === 0) {
      return qb;
    }

    groupBy.forEach((field) => {
      qb.groupBy(field as string);
    });

    return qb;
  }

  applyAggregateSorting<Q extends QueryBuilder<Entity>>(
    qb: Q,
    groupBy?: (keyof Entity)[],
    _alias?: string,
  ): Q {
    if (!groupBy || groupBy.length === 0) {
      return qb;
    }

    const orderBy = groupBy.reduce(
      (acc, field) => ({
        ...acc,
        [field]: 'asc',
      }),
      {} as Record<string, string>,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb.orderBy(orderBy as any) as Q;
  }

  /**
   * Create a MikroORM QueryBuilder.
   */
  private createQueryBuilder(alias?: string): QueryBuilder<Entity> {
    return this.repo.createQueryBuilder(alias);
  }

  /**
   * Gets the entity alias based on the entity name.
   */
  private getEntityAlias(): string {
    const em = this.repo.getEntityManager();
    const meta = em.getMetadata().get(this.repo.getEntityName());
    return meta.className;
  }

  /**
   * Checks if a filter references any relations.
   * @param filter
   * @private
   *
   * @returns true if there are any referenced relations
   */
  filterHasRelations(filter?: Filter<Entity>): boolean {
    if (!filter) {
      return false;
    }
    return this.getReferencedRelations(filter).length > 0;
  }

  private getReferencedRelations(filter: Filter<Entity>): string[] {
    const relationNames = this.relationNames;
    const referencedFields = getFilterFields(filter);
    return referencedFields.filter((f) => relationNames.includes(f));
  }

  getReferencedRelationsRecursive(
    metadataOrFilter: EntityMetadata<Entity> | Filter<unknown> = {},
    filter?: Filter<unknown>,
  ): NestedRecord {
    const em = this.repo.getEntityManager();
    // Handle both signatures: (metadata, filter) and (filter)
    let metadata: EntityMetadata<Entity>;
    let actualFilter: Filter<unknown>;

    if (filter !== undefined) {
      // Called as (metadata, filter)
      metadata = metadataOrFilter as EntityMetadata<Entity>;
      actualFilter = filter;
    } else if ('properties' in metadataOrFilter || 'relations' in metadataOrFilter) {
      // First arg looks like metadata, but no second arg - treat as empty filter
      metadata = metadataOrFilter as EntityMetadata<Entity>;
      actualFilter = {};
    } else {
      // Called as (filter) - backward compatible
      metadata = em.getMetadata().get(this.repo.getEntityName());
      actualFilter = metadataOrFilter as Filter<unknown>;
    }

    const referencedFields = Array.from(
      new Set(Object.keys(actualFilter) as (keyof Filter<unknown>)[]),
    );
    return referencedFields.reduce((prev, curr) => {
      const currFilterValue = actualFilter[curr];
      if ((curr === 'and' || curr === 'or') && currFilterValue) {
        for (const subFilter of currFilterValue as Filter<unknown>[]) {
          prev = merge(prev, this.getReferencedRelationsRecursiveInternal(metadata, subFilter));
        }
      }
      const referencedRelation = metadata.relations.find((r) => r.name === curr);
      if (!referencedRelation) return prev;

      // Get nested relations recursively
      const nestedFilter = currFilterValue as Filter<unknown>;
      const targetMeta = em.getMetadata().get(referencedRelation.type);
      const nestedRelations = nestedFilter
        ? this.getReferencedRelationsRecursiveInternal(targetMeta, nestedFilter)
        : {};

      return {
        ...prev,
        [curr]: merge((prev as NestedRecord)[curr] ?? {}, nestedRelations),
      };
    }, {});
  }

  private getReferencedRelationsRecursiveInternal(
    metadata: EntityMetadata<Entity>,
    filter: Filter<unknown> = {},
  ): NestedRecord {
    const em = this.repo.getEntityManager();
    const referencedFields = Array.from(new Set(Object.keys(filter) as (keyof Filter<unknown>)[]));
    return referencedFields.reduce((prev, curr) => {
      const currFilterValue = filter[curr];
      if ((curr === 'and' || curr === 'or') && currFilterValue) {
        for (const subFilter of currFilterValue as Filter<unknown>[]) {
          prev = merge(prev, this.getReferencedRelationsRecursiveInternal(metadata, subFilter));
        }
      }
      const referencedRelation = metadata.relations.find((r) => r.name === curr);
      if (!referencedRelation) return prev;

      // Get nested relations recursively
      const nestedFilter = currFilterValue as Filter<unknown>;
      const targetMeta = em.getMetadata().get(referencedRelation.type);
      const nestedRelations = nestedFilter
        ? this.getReferencedRelationsRecursiveInternal(targetMeta, nestedFilter)
        : {};

      return {
        ...prev,
        [curr]: merge((prev as NestedRecord)[curr] ?? {}, nestedRelations),
      };
    }, {});
  }

  private get relationNames(): string[] {
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName());
    return metadata.relations.map((r) => r.name);
  }
}
