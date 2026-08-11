import type {
  EntityKey,
  EntityName,
  EntityProperty,
  EntityRepository,
  FilterQuery,
  QueryOrderMap,
} from '@mikro-orm/core';
import { Collection, PopulateHint, Reference, wrap } from '@mikro-orm/core';
import type { AggregateQuery, Query } from '@ptc-org/nestjs-query-core';

import { AggregateBuilder } from './aggregate.builder';
import { FilterQueryBuilder } from './filter-query.builder';

export type EntityIndexRelation<Relation> = Relation & {
  __nestjsQuery__entityIndex__: number;
};

/**
 * The `where` shape `em.find`/`em.count` accept.
 *
 * They declare it as `FilterQuery<NoInfer<T>>`, and TypeScript keeps `NoInfer<T>` opaque while `T`
 * is still an unresolved type parameter - so conditions built here have to be handed over in that
 * exact form rather than as a plain `FilterQuery<T>`.
 */
export type FindWhere<T> = FilterQuery<NoInfer<T>>;

/**
 * The per-relation overrides handed to MikroORM's `populateHints`, so a batched
 * populate can order and page each parent's relations independently.
 */
interface PopulateHints {
  orderBy?: QueryOrderMap<Record<string, unknown>>;
  limit?: number;
  offset?: number;
}

/**
 * How a relation can be loaded for a whole batch of entities at once.
 *
 * - `by-owner`: the relation rows point back at the entity, so they are selected by their owning
 *   property and grouped by it.
 * - `by-relation-key`: the entities hold the foreign key, so the rows are selected by their own
 *   primary key and handed back to whichever entity points at them.
 * - `populate`: the key lives in a pivot table, only MikroORM's populate can resolve it.
 */
type BatchPlan =
  | { mode: 'by-owner'; ownerProperty: string }
  | { mode: 'by-relation-key'; relationPrimaryKey: string; foreignKeys: unknown[] }
  | { mode: 'populate' };

/**
 * @internal
 *
 * Class that will convert a Query into a MikroORM Query Builder for relations.
 */
export class RelationQueryBuilder<Entity extends object, Relation extends object> {
  readonly filterQueryBuilder: FilterQueryBuilder<Relation>;

  constructor(
    readonly repo: EntityRepository<Entity>,
    readonly relation: string,
  ) {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const relationRepo = em.getRepository(
      relationMeta.type as unknown as EntityName<Relation>,
    ) as unknown as EntityRepository<Relation>;
    this.filterQueryBuilder = new FilterQueryBuilder<Relation>(relationRepo);
  }

  /**
   * Executes a relation select using `em.find` so the implementation is database-agnostic.
   */
  async selectAndExecute(entity: Entity, query: Query<Relation>): Promise<Relation[]> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const RelationEntity = relationMeta.type as string;

    const baseWhere = this.buildWhereCondition(entity, relationMeta) as FilterQuery<Relation>;
    const { filterQuery, options } = this.filterQueryBuilder.buildFindOptions(
      query as unknown as Query<Relation>,
    );
    const finalWhere = filterQuery
      ? ({ $and: [baseWhere, filterQuery] } as FilterQuery<Relation>)
      : baseWhere;

    const findOptions: Record<string, unknown> = {};
    if (options?.orderBy) findOptions.orderBy = options.orderBy;
    if (options?.limit !== undefined) findOptions.limit = options.limit;
    if (options?.offset !== undefined) findOptions.offset = options.offset;

    // Use em.find to fetch relations directly; this is database-agnostic and avoids QueryBuilder
    return (await em.find<Relation>(
      RelationEntity as unknown as EntityName<Relation>,
      finalWhere as unknown as FindWhere<Relation>,
      findOptions as Record<string, unknown>,
    )) as Relation[];
  }

  /**
   * Loads the relation for many entities at once.
   *
   * Instead of running one select per entity (an N+1), this issues a single query for the whole
   * batch and maps the rows back onto the entity each of them belongs to, while still applying
   * the filter, sorting and paging per entity. See {@link batchLoad} for how the batch is built.
   *
   * @returns a Map keyed by the passed entities, in the order they were given. Entities whose
   * relation could not be resolved (no matching row) are omitted.
   */
  async batchSelectAndExecute(
    entities: Entity[],
    query: Query<Relation>,
  ): Promise<Map<Entity, Relation[]>> {
    return this.batchLoad(entities, query, true);
  }

  /**
   * Counts the relations of many entities.
   *
   * This deliberately keeps one `count` per entity instead of batching like the other helpers.
   * Counting is the only operation that does not need the relation rows, and a batched select
   * would trade a bounded number of round trips for an unbounded amount of data - counting 25
   * entities that hold ten thousand relations each would hydrate 250k rows to produce 25 numbers.
   * The counts are issued concurrently and each one only carries a single value back.
   *
   * Every passed entity is present in the result, entities without relations map to `0`.
   */
  async batchCount(entities: Entity[], query: Query<Relation>): Promise<Map<Entity, number>> {
    const counts = await Promise.all(entities.map((entity) => this.count(entity, query)));
    return new Map(entities.map((entity, index) => [entity, counts[index]]));
  }

  /**
   * Aggregates the relations of many entities using a single batched query.
   *
   * Every passed entity is present in the result, entities without relations aggregate over an
   * empty set - which is what a per-entity aggregate query would have returned as well.
   */
  async batchAggregate(
    entities: Entity[],
    query: Query<Relation>,
    aggregateQuery: AggregateQuery<Relation>,
  ): Promise<Map<Entity, Record<string, unknown>[]>> {
    const loaded = await this.batchLoad(entities, query, false);
    return new Map(
      entities.map((entity) => [
        entity,
        this.computeAggregates(loaded.get(entity) ?? [], aggregateQuery),
      ]),
    );
  }

  async count(entity: Entity, query: Query<Relation>): Promise<number> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const RelationEntity = relationMeta.type as string;
    const baseWhere = this.buildWhereCondition(entity, relationMeta) as FilterQuery<Relation>;
    const { filterQuery } = this.filterQueryBuilder.buildFindOptions(
      query as unknown as Query<Relation>,
    );
    const finalWhere = filterQuery
      ? ({ $and: [baseWhere, filterQuery] } as FilterQuery<Relation>)
      : baseWhere;
    return em.count<Relation>(
      RelationEntity as unknown as EntityName<Relation>,
      finalWhere as unknown as FindWhere<Relation>,
    );
  }

  async aggregate(
    entity: Entity,
    query: Query<Relation>,
    aggregateQuery: AggregateQuery<Relation>,
  ): Promise<Record<string, unknown>[]> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();

    // Database-agnostic aggregate: fetch matching relations and compute aggregates in-memory
    const RelationEntity = relationMeta.type as string;
    const baseWhere = this.buildWhereCondition(entity, relationMeta) as FilterQuery<Relation>;
    const { filterQuery } = this.filterQueryBuilder.buildFindOptions(
      query as unknown as Query<Relation>,
    );
    const finalWhere = filterQuery
      ? ({ $and: [baseWhere, filterQuery] } as FilterQuery<Relation>)
      : baseWhere;

    // fetch all matching relations (no paging)
    const rows = (await em.find<Relation>(
      RelationEntity as unknown as EntityName<Relation>,
      finalWhere as unknown as FindWhere<Relation>,
    )) as unknown[];

    return this.computeAggregates(rows, aggregateQuery);
  }

  /**
   * Loads the relation for a whole batch of entities with a single query.
   *
   * The batch reuses the very condition the per-entity select would have built, only widened to
   * cover every entity at once, and then groups the rows back per entity:
   *
   * - when the relation row carries the key (`1:m`, `1:1` inverse, and a `1:1` owner whose foreign
   *   key is not on the dto) the relations are selected by their owning property and grouped by it;
   * - when the entity carries the key (`m:1`, `1:1` owner) the relations are selected by their
   *   primary key and each entity is handed the row its foreign key points at;
   * - `m:n` keys live in the pivot table, so MikroORM's `populate`/`populateHints` does the work.
   *
   * @param applyPaging - when false the paging of the query is ignored, which is what the
   * count/aggregate callers need since they have to see every related row.
   */
  private async batchLoad(
    entities: Entity[],
    query: Query<Relation>,
    applyPaging: boolean,
  ): Promise<Map<Entity, Relation[]>> {
    if (entities.length === 0) {
      return new Map<Entity, Relation[]>();
    }

    const relationMeta = this.getRelationMeta();
    const { filterQuery, options } = this.filterQueryBuilder.buildFindOptions(query);
    const paging = applyPaging ? { limit: options?.limit, offset: options?.offset } : {};
    const orderBy = options?.orderBy;

    const plan = this.buildBatchPlan(entities, relationMeta);
    const batched =
      plan.mode === 'populate'
        ? await this.batchLoadThroughPopulate(entities, relationMeta, filterQuery, orderBy, paging)
        : await this.batchLoadThroughRelation(entities, plan, filterQuery, orderBy, paging);

    // Relations we cannot batch (pivot keys we cannot read back) keep the per-entity select.
    return batched ?? this.loadPerEntity(entities, query, applyPaging);
  }

  /**
   * Decides how the relation can be resolved for the whole batch at once.
   */
  private buildBatchPlan(entities: Entity[], relationMeta: EntityProperty<Entity>): BatchPlan {
    if (relationMeta.mapToPk) {
      // Only the foreign key is ever hydrated, never the related entity, so there is nothing to
      // group the rows by.
      return { mode: 'populate' };
    }

    const em = this.repo.getEntityManager();
    const relationEntityMeta = em
      .getMetadata()
      .get(relationMeta.type as unknown as EntityName<Relation>);
    const relationPrimaryKey = relationEntityMeta.primaryKeys[0];

    if (relationMeta.kind === '1:m') {
      return relationMeta.mappedBy
        ? { mode: 'by-owner', ownerProperty: relationMeta.mappedBy }
        : { mode: 'populate' };
    }

    if (relationMeta.kind === '1:1') {
      if (!relationMeta.owner) {
        return relationMeta.mappedBy
          ? { mode: 'by-owner', ownerProperty: relationMeta.mappedBy }
          : { mode: 'populate' };
      }

      const foreignKeys = entities.map((entity) =>
        this.normalizePrimaryKeyValue(
          this.getOneToOneOwnerForeignKey(entity, relationMeta, relationPrimaryKey),
        ),
      );
      if (foreignKeys.every((fk) => fk !== undefined && fk !== null)) {
        return { mode: 'by-relation-key', relationPrimaryKey, foreignKeys };
      }
      // The dtos do not carry the foreign key, so resolve through the inverse side instead.
      return relationMeta.inversedBy
        ? { mode: 'by-owner', ownerProperty: relationMeta.inversedBy }
        : { mode: 'by-relation-key', relationPrimaryKey, foreignKeys };
    }

    if (relationMeta.kind === 'm:1') {
      return {
        mode: 'by-relation-key',
        relationPrimaryKey,
        foreignKeys: entities.map((entity) =>
          this.normalizePrimaryKeyValue(
            this.getManyToOneForeignKey(entity, relationMeta, relationPrimaryKey),
          ),
        ),
      };
    }

    return { mode: 'populate' };
  }

  /**
   * Selects the relations of the whole batch in one query and groups them back per entity.
   */
  private async batchLoadThroughRelation(
    entities: Entity[],
    plan: Exclude<BatchPlan, { mode: 'populate' }>,
    filterQuery: FilterQuery<Relation> | undefined,
    orderBy: Record<string, unknown> | undefined,
    paging: { limit?: number; offset?: number },
  ): Promise<Map<Entity, Relation[]>> {
    const em = this.repo.getEntityManager();
    const relationMeta = this.getRelationMeta();
    const RelationEntity = relationMeta.type as unknown as EntityName<Relation>;
    const findOptions: Record<string, unknown> = orderBy ? { orderBy } : {};
    const results = new Map<Entity, Relation[]>();

    if (plan.mode === 'by-relation-key') {
      const keys = plan.foreignKeys.map((fk) =>
        fk === undefined || fk === null ? undefined : JSON.stringify(fk),
      );
      const values = Array.from(
        new Map(
          plan.foreignKeys
            .map((fk, i) => [keys[i], fk] as const)
            .filter(([key]) => key !== undefined),
        ).values(),
      );
      if (values.length === 0) {
        return results;
      }

      const rows = (await em.find<Relation>(
        RelationEntity,
        this.andWhere(
          { [plan.relationPrimaryKey]: { $in: values } },
          filterQuery,
        ) as FindWhere<Relation>,
        findOptions,
      )) as Relation[];

      const rowsByKey = new Map<string, Relation>();
      rows.forEach((row) => {
        const value = this.normalizePrimaryKeyValue(
          (row as Record<string, unknown>)[plan.relationPrimaryKey],
        );
        if (value !== undefined && value !== null) {
          rowsByKey.set(JSON.stringify(value), row);
        }
      });

      entities.forEach((entity, index) => {
        const key = keys[index];
        if (key === undefined) {
          return;
        }
        const row = rowsByKey.get(key);
        results.set(entity, this.sliceRelations(row ? [row] : [], paging));
      });

      return results;
    }

    const entityMeta = em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<Entity>);
    const primaryKeys = entityMeta.primaryKeys;
    const keys = entities.map((entity) => this.getPrimaryKeyValues(entity, primaryKeys));

    const conditions = Array.from(
      new Map(
        keys
          .filter((pkValues): pkValues is unknown[] => pkValues !== undefined)
          .map((pkValues) => [
            JSON.stringify(pkValues),
            Object.fromEntries(primaryKeys.map((pk, i) => [pk, pkValues[i]])),
          ]),
      ).values(),
    );
    if (conditions.length === 0) {
      return results;
    }

    const ownerWhere =
      primaryKeys.length === 1
        ? { [plan.ownerProperty]: { $in: conditions.map((c) => c[primaryKeys[0]]) } }
        : { $or: conditions.map((c) => ({ [plan.ownerProperty]: c })) };

    const rows = (await em.find<Relation>(
      RelationEntity,
      this.andWhere(ownerWhere, filterQuery) as FindWhere<Relation>,
      findOptions,
    )) as Relation[];

    const rowsByOwner = new Map<string, Relation[]>();
    rows.forEach((row) => {
      const key = this.getOwnerKey(row, plan.ownerProperty, primaryKeys);
      if (key === undefined) {
        return;
      }
      const existing = rowsByOwner.get(key);
      if (existing) {
        existing.push(row);
      } else {
        rowsByOwner.set(key, [row]);
      }
    });

    entities.forEach((entity, index) => {
      const pkValues = keys[index];
      if (!pkValues) {
        return;
      }
      const relations = rowsByOwner.get(JSON.stringify(pkValues)) ?? [];
      results.set(entity, this.sliceRelations(relations, paging));
    });

    return results;
  }

  /**
   * Loads a pivot backed relation for the whole batch by resolving the entities once and letting
   * MikroORM populate the relation on all of them, paging each parent through `populateHints`.
   *
   * @returns null when the entities do not materialize the relation as a collection, in which case
   * there is nothing to read the populated rows from.
   */
  private async batchLoadThroughPopulate(
    entities: Entity[],
    relationMeta: EntityProperty<Entity>,
    filterQuery: FilterQuery<Relation> | undefined,
    orderBy: Record<string, unknown> | undefined,
    paging: { limit?: number; offset?: number },
  ): Promise<Map<Entity, Relation[]> | null> {
    if (relationMeta.kind !== 'm:n') {
      return null;
    }

    const em = this.repo.getEntityManager();
    const entityMeta = em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<Entity>);
    const primaryKeys = entityMeta.primaryKeys;
    const keys = entities.map((entity) => this.getPrimaryKeyValues(entity, primaryKeys));

    const conditions = Array.from(
      new Map(
        keys
          .filter((pkValues): pkValues is unknown[] => pkValues !== undefined)
          .map((pkValues) => [
            JSON.stringify(pkValues),
            Object.fromEntries(primaryKeys.map((pk, i) => [pk, pkValues[i]])),
          ]),
      ).values(),
    );
    const results = new Map<Entity, Relation[]>();
    if (conditions.length === 0) {
      return results;
    }

    const hints: PopulateHints = {};
    if (orderBy) {
      hints.orderBy = orderBy as QueryOrderMap<Record<string, unknown>>;
    }
    // MikroORM only limits per parent when there is a limit to partition by, anything else is
    // sliced once the rows are grouped.
    const hintedPaging = paging.limit !== undefined;
    if (hintedPaging) {
      hints.limit = paging.limit;
      if (paging.offset !== undefined) {
        hints.offset = paging.offset;
      }
    }

    const findOptions: Record<string, unknown> = {
      populate: [this.relation],
      // An object `populateWhere` filters the populated relation only, it never discards parents.
      populateWhere: filterQuery ? { [this.relation]: filterQuery } : PopulateHint.ALL,
    };
    if (Object.keys(hints).length > 0) {
      findOptions.populateHints = { [this.relation]: hints };
    }

    const parents = (await em.find<Entity>(
      this.repo.getEntityName() as unknown as EntityName<Entity>,
      (primaryKeys.length === 1
        ? { [primaryKeys[0]]: { $in: conditions.map((c) => c[primaryKeys[0]]) } }
        : { $or: conditions }) as unknown as FindWhere<Entity>,
      findOptions,
    )) as Entity[];

    const relationsByKey = new Map<string, Relation[]>();
    for (const parent of parents) {
      const collection = (parent as Record<string, unknown>)[this.relation];
      if (!(collection instanceof Collection) || !collection.isInitialized()) {
        // The entity does not hold the relation as a collection, so the populate has nothing to
        // write to and there is no way to read the rows back.
        return null;
      }
      const pkValues = this.getPrimaryKeyValues(parent, primaryKeys);
      if (pkValues) {
        relationsByKey.set(JSON.stringify(pkValues), collection.getItems(false) as Relation[]);
      }
    }

    entities.forEach((entity, index) => {
      const pkValues = keys[index];
      if (!pkValues) {
        return;
      }
      const relations = relationsByKey.get(JSON.stringify(pkValues)) ?? [];
      results.set(entity, hintedPaging ? [...relations] : this.sliceRelations(relations, paging));
    });

    return results;
  }

  /**
   * Runs the per-entity select, used for relations that cannot be batched.
   */
  private async loadPerEntity(
    entities: Entity[],
    query: Query<Relation>,
    applyPaging: boolean,
  ): Promise<Map<Entity, Relation[]>> {
    const effectiveQuery = applyPaging ? query : { ...query, paging: undefined };
    const results = new Map<Entity, Relation[]>();
    const loaded = await Promise.all(
      entities.map((entity) => this.selectAndExecute(entity, effectiveQuery)),
    );
    entities.forEach((entity, index) => results.set(entity, loaded[index]));
    return results;
  }

  private andWhere(
    baseWhere: Record<string, unknown>,
    filterQuery: FilterQuery<Relation> | undefined,
  ): FilterQuery<Relation> {
    return (filterQuery
      ? { $and: [baseWhere, filterQuery] }
      : baseWhere) as unknown as FilterQuery<Relation>;
  }

  private sliceRelations(
    relations: Relation[],
    paging: { limit?: number; offset?: number },
  ): Relation[] {
    if (paging.limit === undefined && paging.offset === undefined) {
      return [...relations];
    }
    const offset = paging.offset ?? 0;
    return relations.slice(offset, paging.limit === undefined ? undefined : offset + paging.limit);
  }

  /**
   * Reads the key of the entity a relation row belongs to, so the rows can be grouped per entity.
   */
  private getOwnerKey(
    row: Relation,
    ownerProperty: string,
    primaryKeys: string[],
  ): string | undefined {
    const owner = (row as Record<string, unknown>)[ownerProperty];
    if (owner === null || owner === undefined) {
      return undefined;
    }
    if (typeof owner !== 'object') {
      return primaryKeys.length === 1 ? JSON.stringify([owner]) : undefined;
    }
    const unwrapped = Reference.unwrapReference(owner as object);
    if (!unwrapped) {
      return undefined;
    }
    const values = this.getPrimaryKeyValues(unwrapped, primaryKeys);
    return values ? JSON.stringify(values) : undefined;
  }

  /**
   * Reads the primary key values off an entity, which may be a managed entity or a plain DTO.
   *
   * @returns undefined when any part of the key is missing, meaning the entity cannot be matched.
   */
  private getPrimaryKeyValues(entity: object, primaryKeys: string[]): unknown[] | undefined {
    const values: unknown[] = [];
    for (const primaryKey of primaryKeys) {
      const value = this.normalizePrimaryKeyValue((entity as Record<string, unknown>)[primaryKey]);
      if (value === undefined || value === null) {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  private normalizePrimaryKeyValue(value: unknown): unknown {
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }
    const unwrapped = Reference.unwrapReference(value as object) as Record<string, unknown>;
    if (!unwrapped) {
      return undefined;
    }
    const wrapped = wrap(unwrapped) as { getPrimaryKey?: () => unknown };
    return typeof wrapped?.getPrimaryKey === 'function' ? wrapped.getPrimaryKey() : unwrapped;
  }

  /**
   * Computes the requested aggregates over already fetched rows, so the behaviour is identical
   * for every driver.
   */
  /**
   * Reduces the loaded relations into aggregate records, keyed the way
   * {@link AggregateBuilder.convertToAggregateResponse} expects to read them back.
   */
  private computeAggregates(
    rows: unknown[],
    aggregateQuery: AggregateQuery<Relation>,
  ): Record<string, unknown>[] {
    return AggregateBuilder.computeAggregates(rows, aggregateQuery);
  }

  /**
   * Reads the foreign key a many-to-one relation points at off an entity, which may be a managed
   * entity or a plain dto that only carries the key under a conventional name.
   */
  private getManyToOneForeignKey(
    entity: Entity,
    relationMeta: EntityProperty<Entity>,
    relationPrimaryKey: string,
  ): unknown {
    // Many-to-One: The foreign key is on the current entity
    // Try to get FK from multiple sources in order of preference
    let fkValue: unknown;
    const entityAsRecord = entity as Record<string, unknown>;

    // 1. Try the auto-generated FK field (e.g., test_entity_uni_directional_test_entity_pk)
    const fkFieldName = relationMeta.fieldNames?.[0];
    if (fkFieldName) {
      fkValue = entityAsRecord[fkFieldName];
    }

    // 2. If FK field not set, try common property naming pattern (e.g., testEntityId for testEntity relation)
    if (fkValue === undefined) {
      // Try relationName + 'Id'
      const conventionalIdField = `${relationMeta.name}Id`;
      fkValue = entityAsRecord[conventionalIdField];
    }

    // 3. If still undefined, try case-insensitive search for property matching relation name + Id
    // This handles cases where plain objects have properties like 'testEntityId' for 'testEntity' relation
    // or 'uniDirectionalTestEntityId' for 'testEntityUniDirectional' relation
    if (fkValue === undefined) {
      const relationNameLower = relationMeta.name.toLowerCase();
      const entityKeys = Object.keys(entityAsRecord);
      // Look for any property that ends with the relation name (case-insensitive) + Id
      const matchingKey = entityKeys.find((key) => {
        const keyLower = key.toLowerCase();
        if (keyLower === 'id' || !keyLower.endsWith('id')) {
          return false;
        }
        const base = keyLower.replace(/id$/, '');
        if (!base) {
          return false;
        }
        return relationNameLower.includes(base);
      });
      if (matchingKey) {
        fkValue = entityAsRecord[matchingKey];
      }
    }

    // 4. If still undefined, try getting it from the loaded relation object
    if (fkValue === undefined) {
      const relationValue = entityAsRecord[relationMeta.name];
      if (typeof relationValue === 'object' && relationValue !== null) {
        fkValue = (relationValue as Record<string, unknown>)[relationPrimaryKey];
      } else {
        fkValue = relationValue;
      }
    }

    return fkValue;
  }

  /**
   * Reads the foreign key of an owning one-to-one relation off an entity.
   *
   * @returns undefined when the entity does not carry the key, the relation then has to be
   * resolved through its inverse side.
   */
  private getOneToOneOwnerForeignKey(
    entity: Entity,
    relationMeta: EntityProperty<Entity>,
    relationPrimaryKey: string,
  ): unknown {
    // We own the FK, but we might not have it loaded
    // Try multiple approaches to get the FK value:

    // 1. Try the FK field (e.g., one_test_relation_test_relation_pk)
    const fkFieldName = relationMeta.joinColumns?.[0] || relationMeta.fieldNames?.[0];
    let fkValue: unknown;

    if (fkFieldName) {
      fkValue = (entity as Record<string, unknown>)[fkFieldName];
    }

    // 2. If FK field not set, try getting it from the loaded relation object
    if (fkValue === undefined) {
      const relationValue = (entity as Record<string, unknown>)[relationMeta.name];
      if (typeof relationValue === 'object' && relationValue !== null) {
        fkValue = (relationValue as Record<string, unknown>)[relationPrimaryKey];
      } else {
        fkValue = relationValue;
      }
    }

    return fkValue;
  }

  private buildWhereCondition(
    entity: Entity,
    relationMeta: EntityProperty<Entity>,
  ): Record<string, unknown> {
    const em = this.repo.getEntityManager();
    const entityMeta = em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<Entity>);
    const relationEntityMeta = em
      .getMetadata()
      .get(relationMeta.type as unknown as EntityName<Relation>);
    const entityPrimaryKey = entityMeta.primaryKeys[0];
    const relationPrimaryKey = relationEntityMeta.primaryKeys[0];
    const entityId = (entity as Record<string, unknown>)[entityPrimaryKey];

    // Determine the relation type and build appropriate condition
    if (relationMeta.kind === 'm:1') {
      return {
        [relationPrimaryKey]: this.getManyToOneForeignKey(entity, relationMeta, relationPrimaryKey),
      };
    }

    if (relationMeta.kind === '1:1') {
      // One-to-One: Depends on which side owns the relationship
      if (relationMeta.owner) {
        const fkValue = this.getOneToOneOwnerForeignKey(entity, relationMeta, relationPrimaryKey);

        // If the foreign key is not on the entity, we need to query via the inverse side
        // Query where the relation's inverse property matches our PK
        if (fkValue === undefined && relationMeta.inversedBy) {
          return { [relationMeta.inversedBy]: entityId };
        }

        return { [relationPrimaryKey]: fkValue };
      } else {
        // The other side owns the FK, so query where their FK matches our PK
        return { [relationMeta.mappedBy!]: entityId };
      }
    }

    if (relationMeta.kind === '1:m') {
      // One-to-Many: The foreign key is on the related entity
      const mappedBy = relationMeta.mappedBy;
      return { [mappedBy!]: entityId };
    }

    if (relationMeta.kind === 'm:n') {
      // Many-to-Many: Need to query through the pivot table
      // MikroORM handles this automatically through the relation
      if (relationMeta.owner) {
        return { [relationMeta.inversedBy!]: entityId };
      } else {
        return { [relationMeta.mappedBy!]: entityId };
      }
    }

    // Default case for other relation types
    return { [entityPrimaryKey]: entityId };
  }

  private getRelationMeta(): EntityProperty<Entity> {
    const em = this.repo.getEntityManager();
    const metadata = em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<Entity>);
    const relationProp = metadata.properties[this.relation as EntityKey<Entity>];

    if (!relationProp) {
      throw new Error(`Unable to find relation '${this.relation}' on entity`);
    }

    return relationProp as EntityProperty<Entity>;
  }

  get entityIndexColName(): string {
    return '__nestjsQuery__entityIndex__';
  }

  getRelationPrimaryKeysPropertyNameAndColumnsName(): {
    columnName: string;
    propertyName: string;
  }[] {
    const em = this.repo.getEntityManager();
    const relationMeta = this.getRelationMeta();
    const relationEntityMeta = em
      .getMetadata()
      .get(relationMeta.type as unknown as EntityName<Relation>);

    return relationEntityMeta.primaryKeys.map((pk) => {
      const prop = relationEntityMeta.properties[pk];
      return {
        propertyName: pk,
        columnName: prop.fieldNames?.[0] || pk,
      };
    });
  }
}
