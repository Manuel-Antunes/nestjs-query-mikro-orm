import type {
  EntityData,
  EntityMetadata,
  EntityName,
  FilterQuery,
  RequiredEntityData,
} from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/core';
import type {
  AggregateQuery,
  AggregateResponse,
  Class,
  DeepPartial,
  DeleteManyResponse,
  DeleteOneOptions,
  Filter,
  Filterable,
  FindByIdOptions,
  GetByIdOptions,
  Query,
  QueryService,
  UpdateManyResponse,
  UpdateOneOptions,
} from '@ptc-org/nestjs-query-core';
import { wrap } from '@mikro-orm/core';
import { AssemblerDeserializer, AssemblerSerializer } from '@ptc-org/nestjs-query-core';
import { getAssemblerSerializer } from '@ptc-org/nestjs-query-core/src/assemblers/assembler.serializer';
import { MethodNotAllowedException, NotFoundException } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

import type { AggregateStrategy } from '../aggregate';
import { InMemoryAggregateStrategy, normalizeAggregateRecords } from '../aggregate';
import { AggregateBuilder, FilterQueryBuilder, WhereBuilder } from '../query';
import { RelationQueryService } from './relation-query.service';

export interface MikroOrmQueryServiceOpts<Entity extends object> {
  useSoftDelete?: boolean;
  filterQueryBuilder?: FilterQueryBuilder<Entity>;
  /**
   * How aggregates are computed.
   *
   * Defaults to {@link InMemoryAggregateStrategy}, which works against every driver by reducing
   * the matching rows in JavaScript. Swap in `SqlAggregateStrategy` from
   * `nestjs-query-mikro-orm/sql` or `MongoAggregateStrategy` from `nestjs-query-mikro-orm/mongo`
   * to push the work into the database, or bring your own for another backend.
   */
  aggregateStrategy?: AggregateStrategy;
}

/**
 * Base class for all query services that use a MikroORM EntityRepository.
 *
 * @example
 *
 * ```ts
 * @QueryService(TodoItemEntity)
 * export class TodoItemService extends MikroOrmQueryService<TodoItemEntity> {
 *   constructor(
 *     @InjectRepository(TodoItemEntity) repo: EntityRepository<TodoItemEntity>,
 *   ) {
 *     super(repo);
 *   }
 * }
 * ```
 */
export class MikroOrmQueryService<Entity extends object>
  extends RelationQueryService<Entity>
  implements QueryService<Entity, DeepPartial<Entity>, DeepPartial<Entity>>
{
  readonly filterQueryBuilder: FilterQueryBuilder<Entity>;

  readonly useSoftDelete: boolean;

  readonly aggregateStrategy: AggregateStrategy;

  constructor(
    readonly repo: EntityRepository<Entity>,
    opts?: MikroOrmQueryServiceOpts<Entity>,
  ) {
    super();
    this.filterQueryBuilder = opts?.filterQueryBuilder ?? new FilterQueryBuilder<Entity>(this.repo);
    this.useSoftDelete = opts?.useSoftDelete ?? false;
    this.aggregateStrategy = opts?.aggregateStrategy ?? new InMemoryAggregateStrategy();
    const serializer = getAssemblerSerializer(this.EntityClass);
    if (!serializer) {
      AssemblerSerializer((e: Entity) => {
        const json = instanceToPlain(e, {
          enableImplicitConversion: true,
          excludeExtraneousValues: true,
          exposeDefaultValues: true,
        });
        const jsonWithRemovedEmptyObjects = Object.fromEntries(
          Object.entries(json as object).filter(
            ([, value]) =>
              !(
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                Object.keys(value).length === 0
              ),
          ),
        );
        const wrapped = wrap(e, true);
        const ormJson = 'toObject' in wrapped ? wrapped.toObject() : {};

        const data = {
          ...ormJson,
          ...jsonWithRemovedEmptyObjects,
        };

        return data;
      })(this.EntityClass);
      AssemblerDeserializer((d: DeepPartial<Entity>) => {
        const entity = this.repo
          .getEntityManager()
          .create(this.EntityClass, d as RequiredEntityData<Entity>, {
            managed: true,
            convertCustomTypes: true,
            partial: true,
          }) as Entity;
        return entity;
      })(this.EntityClass);
    }
  }

  get EntityClass(): Class<Entity> {
    return this.metadata.class as Class<Entity>;
  }

  /**
   * The MikroORM metadata for the entity this service is bound to.
   *
   * `getEntityName()` hands back the registered name as a `string`, which `EntityName` no longer
   * admits since MikroORM v7 even though the lookup resolves it by name at runtime - so the cast
   * lives here, once, instead of at every call site.
   */
  private get metadata(): EntityMetadata<Entity> {
    return this.repo
      .getEntityManager()
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<Entity>);
  }

  /**
   * Query for multiple entities, using a Query from `@ptc-org/nestjs-query-core`.
   *
   * @example
   * ```ts
   * const todoItems = await this.service.query({
   *   filter: { title: { eq: 'Foo' } },
   *   paging: { limit: 10 },
   *   sorting: [{ field: "create", direction: SortDirection.DESC }],
   * });
   * ```
   * @param query - The Query used to filter, page, and sort rows.
   */
  async query(query: Query<Entity>): Promise<Entity[]> {
    const { filterQuery, options } = this.filterQueryBuilder.buildFindOptions(query);
    const where = this.buildWhere(filterQuery as FilterQuery<Entity> | undefined);
    return this.em.find(this.EntityClass, where, options as Record<string, unknown>);
  }

  /**
   * Narrows an already converted filter with the soft delete condition, so every path that reads
   * or writes rows hides soft deleted ones the same way.
   */
  private buildWhere(filterQuery?: FilterQuery<Entity>): FilterQuery<Entity> {
    if (!this.useSoftDelete) {
      return filterQuery ?? ({} as FilterQuery<Entity>);
    }
    const notDeleted = { deletedAt: null } as FilterQuery<Entity>;
    return (filterQuery ? { $and: [filterQuery, notDeleted] } : notDeleted) as FilterQuery<Entity>;
  }

  /**
   * Converts a `Filter` straight into the `where` a MikroORM call expects, soft delete included.
   */
  private buildWhereFromFilter(filter: Filter<Entity>): FilterQuery<Entity> {
    const { filterQuery } = this.filterQueryBuilder.buildFindOptions({ filter } as Query<Entity>);
    return this.buildWhere(filterQuery as FilterQuery<Entity> | undefined);
  }

  async aggregate(
    filter: Filter<Entity>,
    aggregate: AggregateQuery<Entity>,
  ): Promise<AggregateResponse<Entity>[]> {
    const meta = this.metadata;
    const records = await this.aggregateStrategy.execute<Entity>({
      em: this.em,
      meta,
      where: this.buildWhereFromFilter(filter),
      aggregate,
    });

    // normalize first: every strategy answers in its backend's own currency
    return AggregateBuilder.convertToAggregateResponse<Entity>(
      normalizeAggregateRecords(records, meta),
    );
  }

  async count(filter: Filter<Entity>): Promise<number> {
    return this.em.count(this.EntityClass, this.buildWhereFromFilter(filter));
  }

  /**
   * Find an entity by it's `id`.
   *
   * @example
   * ```ts
   * const todoItem = await this.service.findById(1);
   * ```
   * @param id - The id of the record to find.
   */
  async findById(id: string | number, opts?: FindByIdOptions<Entity>): Promise<Entity | undefined> {
    const primaryKey = this.primaryKey as keyof Entity;
    let where: FilterQuery<Entity> = { [primaryKey]: id } as FilterQuery<Entity>;
    if (opts?.filter) {
      const whereBuilder = new WhereBuilder<Entity>();
      const additional = whereBuilder.build(opts.filter);
      where = { $and: [where, additional] } as unknown as FilterQuery<Entity>;
    }
    if (this.useSoftDelete) {
      where = { $and: [where, { deletedAt: null }] } as unknown as FilterQuery<Entity>;
    }
    const entity = await this.em.findOne(this.EntityClass, where as FilterQuery<Entity>);
    return entity ?? undefined;
  }

  /**
   * Gets an entity by it's `id`. If the entity is not found a rejected promise is returned.
   *
   * @example
   * ```ts
   * try {
   *   const todoItem = await this.service.getById(1);
   * } catch(e) {
   *   console.error('Unable to find entity with id = 1');
   * }
   * ```
   * @param id - The id of the record to find.
   */
  async getById(id: string | number, opts?: GetByIdOptions<Entity>): Promise<Entity> {
    const entity = await this.findById(id, opts);
    if (!entity) {
      throw new NotFoundException(`Unable to find ${this.EntityClass.name} with id: ${id}`);
    }
    return entity;
  }

  /**
   * Creates a single entity.
   *
   * @example
   * ```ts
   * const todoItem = await this.service.createOne({title: 'Todo Item', completed: false });
   * ```
   * @param record - The entity to create.
   */
  async createOne(record: DeepPartial<Entity>): Promise<Entity> {
    const entity = await this.ensureIsEntityAndDoesNotExist(record);
    await this.repo.getEntityManager().persist(entity).flush();
    return entity;
  }

  /**
   * Create multiple entities.
   *
   * @example
   * ```ts
   * const todoItem = await this.service.createMany([
   *   {title: 'Todo Item 1', completed: false },
   *   {title: 'Todo Item 2', completed: true },
   * ]);
   * ```
   * @param records - The entities to create.
   */
  async createMany(records: DeepPartial<Entity>[]): Promise<Entity[]> {
    const entities = await Promise.all(records.map((r) => this.ensureIsEntityAndDoesNotExist(r)));
    await this.repo.getEntityManager().persist(entities).flush();
    return entities;
  }

  /**
   * Update an entity.
   *
   * @example
   * ```ts
   * const updatedEntity = await this.service.updateOne(1, { completed: true });
   * ```
   * @param id - The `id` of the record.
   * @param update - A `Partial` of the entity with fields to update.
   * @param opts - Additional options.
   */
  async updateOne(
    id: number | string,
    update: DeepPartial<Entity>,
    opts?: UpdateOneOptions<Entity>,
  ): Promise<Entity> {
    const data = this.toUpdatePayload(update);
    this.ensureIdIsNotPresent(data);
    const entity = await this.getById(id, opts);

    this.assignPatch(entity, data as Record<string, unknown>);
    await this.repo.getEntityManager().flush();
    return entity;
  }

  /**
   * Update multiple entities with a `@ptc-org/nestjs-query-core` Filter.
   *
   * @example
   * ```ts
   * const { updatedCount } = await this.service.updateMany(
   *   { completed: true }, // the update to apply
   *   { title: { eq: 'Foo Title' } } // Filter to find records to update
   * );
   * ```
   * @param update - A `Partial` of entity with the fields to update
   * @param filter - A Filter used to find the records to update
   */
  async updateMany(
    update: DeepPartial<Entity>,
    filter: Filter<Entity>,
  ): Promise<UpdateManyResponse> {
    this.ensureIdIsNotPresent(update);
    const data = this.toUpdatePayload(update);

    const updatedCount = await this.em.nativeUpdate(
      this.EntityClass,
      this.buildWhereFromFilter(filter),
      data as EntityData<Entity>,
    );
    this.evictManagedEntities();

    return { updatedCount };
  }

  /**
   * Delete an entity by `id`.
   *
   * @example
   *
   * ```ts
   * const deletedTodo = await this.service.deleteOne(1);
   * ```
   *
   * @param id - The `id` of the entity to delete.
   * @param filter Additional filter to use when finding the entity to delete.
   */
  async deleteOne(id: string | number, opts?: DeleteOneOptions<Entity>): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const em = this.repo.getEntityManager();
    if (this.useSoftDelete) {
      // For soft delete, set the deletedAt field
      this.assignPatch(entity, { deletedAt: new Date() });
      await em.flush();
    } else {
      await em.remove(entity).flush();
    }
    return entity;
  }

  /**
   * Delete multiple records with a `@ptc-org/nestjs-query-core` `Filter`.
   *
   * @example
   *
   * ```ts
   * const { deletedCount } = this.service.deleteMany({
   *   created: { lte: new Date('2020-1-1') }
   * });
   * ```
   *
   * @param filter - A `Filter` to find records to delete.
   */
  async deleteMany(filter: Filter<Entity>): Promise<DeleteManyResponse> {
    const where = this.buildWhereFromFilter(filter);

    const deletedCount = this.useSoftDelete
      ? await this.em.nativeUpdate(this.EntityClass, where, this.softDeletePayload(new Date()))
      : await this.em.nativeDelete(this.EntityClass, where);
    this.evictManagedEntities();

    return { deletedCount };
  }

  /**
   * Restore an entity by `id`.
   *
   * @example
   *
   * ```ts
   * const restoredTodo = await this.service.restoreOne(1);
   * ```
   *
   * @param id - The `id` of the entity to restore.
   * @param opts Additional filter to use when finding the entity to restore.
   */
  async restoreOne(id: string | number, opts?: Filterable<Entity>): Promise<Entity> {
    this.ensureSoftDeleteEnabled();
    // When restoring, we need to find soft-deleted entities, so bypass filters
    const em = this.repo.getEntityManager();
    const primaryKey = this.primaryKey as keyof Entity;

    let whereClause: FilterQuery<Entity> = {
      [primaryKey]: id,
    } as FilterQuery<Entity>;
    if (opts?.filter) {
      // Merge the additional filter with the ID filter
      const whereBuilder = new WhereBuilder<Entity>();
      const additionalWhere = whereBuilder.build(opts.filter);
      whereClause = {
        $and: [whereClause, additionalWhere as FilterQuery<Entity>],
      } as FilterQuery<Entity>;
    }

    const entity = await em.findOne(this.EntityClass, whereClause, {
      filters: false,
    });
    if (!entity) {
      throw new NotFoundException(`Unable to find ${this.EntityClass.name} with id: ${id}`);
    }
    this.assignPatch(entity, { deletedAt: null });
    await em.flush();
    return entity;
  }

  /**
   * Restores multiple records with a `@ptc-org/nestjs-query-core` `Filter`.
   *
   * @example
   *
   * ```ts
   * const { updatedCount } = this.service.restoreMany({
   *   created: { lte: new Date('2020-1-1') }
   * });
   * ```
   *
   * @param filter - A `Filter` to find records to restore.
   */
  async restoreMany(filter: Filter<Entity>): Promise<UpdateManyResponse> {
    this.ensureSoftDeleteEnabled();
    const whereBuilder = new WhereBuilder<Entity>();
    const whereClause = whereBuilder.build(filter) as FilterQuery<Entity>;

    // When restoring, we need to find soft-deleted entities, so bypass filters
    const updatedCount = await this.em.nativeUpdate(
      this.EntityClass,
      whereClause,
      this.softDeletePayload(null),
      { filters: false },
    );
    this.evictManagedEntities();

    return { updatedCount };
  }

  private get em() {
    return this.repo.getEntityManager();
  }

  private get primaryKey(): string {
    return this.metadata.primaryKeys[0];
  }

  /**
   * The `deletedAt` write that flags a row as soft deleted, or clears the flag when restoring.
   *
   * `Entity` is only known to be an object here, so the soft delete column cannot be proven to
   * exist on it - {@link useSoftDelete} is the caller's promise that it does.
   */
  private softDeletePayload(deletedAt: Date | null): EntityData<Entity> {
    return { deletedAt } as unknown as EntityData<Entity>;
  }

  /**
   * Strips the keys an update should not carry: `undefined` values, which `assign` would otherwise
   * write as `null`, and the MikroORM internals a managed entity drags along.
   */
  private toUpdatePayload(update: DeepPartial<Entity>): DeepPartial<Entity> {
    const data = 'toPOJO' in wrap(update) ? wrap(update).toPOJO() : update;
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as DeepPartial<Entity>;
  }

  /**
   * Detaches the managed instances of this entity type from the identity map.
   *
   * `nativeUpdate`/`nativeDelete` write straight to the database without going through the unit of
   * work, so whatever the identity map still holds for this entity type describes the rows as they
   * looked *before* the statement ran, and a later read would serve those stale instances. Only
   * this entity type is evicted, so anything else the caller has in flight survives - which is what
   * the previous `em.clear()` could not promise.
   */
  private evictManagedEntities(): void {
    const uow = this.em.getUnitOfWork();
    for (const managed of uow.getIdentityMap().values()) {
      if (managed instanceof this.EntityClass) {
        uow.unsetIdentity(managed);
      }
    }
  }

  private async ensureIsEntityAndDoesNotExist(e: DeepPartial<Entity>): Promise<Entity> {
    // The lookup runs against the incoming payload, before `em.create()` can register the new
    // entity: once it is in the identity map the lookup would find the very row we are about to
    // insert and report it as a conflict.
    await this.ensureIdIsFree(e as Record<string, unknown>);

    if (!(e instanceof this.EntityClass)) {
      return this.em.create(this.EntityClass, e as RequiredEntityData<Entity>) as Entity;
    }
    return e;
  }

  private async ensureIdIsFree(payload: Record<string, unknown>): Promise<void> {
    const primaryKey = this.primaryKey;
    const id = payload[primaryKey];
    if (!id) {
      return;
    }

    // The check runs on a fork so it can never observe - nor disturb - the caller's unit of work:
    // a fork starts with an empty identity map, so the row has to come from the database, and
    // nothing pending on the caller's EntityManager is flushed or detached to get it.
    const found = await this.em
      .fork({ clear: true })
      .findOne(this.EntityClass, { [primaryKey]: id } as FilterQuery<Entity>);
    if (found) {
      throw new Error('Entity already exists');
    }
  }

  private ensureIdIsNotPresent(e: DeepPartial<Entity>): void {
    if ((e as Record<string, unknown>)[this.primaryKey]) {
      throw new Error('Id cannot be specified when updating');
    }
  }

  private ensureSoftDeleteEnabled(): void {
    if (!this.useSoftDelete) {
      throw new MethodNotAllowedException(
        `Restore not allowed for non soft deleted entity ${this.EntityClass.name}.`,
      );
    }
  }
}
