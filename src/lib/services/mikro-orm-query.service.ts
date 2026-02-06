import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/knex';
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
} from '@nestjs-query/core';
import { wrap } from '@mikro-orm/core';
import { AssemblerDeserializer, AssemblerSerializer } from '@nestjs-query/core';
import { getAssemblerSerializer } from '@nestjs-query/core/dist/src/assemblers/assembler.serializer';
import { MethodNotAllowedException, NotFoundException } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

import { AggregateBuilder, FilterQueryBuilder, WhereBuilder } from '../query';
import { RelationQueryService } from './relation-query.service';

export interface MikroOrmQueryServiceOpts<Entity extends object> {
  useSoftDelete?: boolean;
  filterQueryBuilder?: FilterQueryBuilder<Entity>;
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

  constructor(
    readonly repo: EntityRepository<Entity>,
    opts?: MikroOrmQueryServiceOpts<Entity>,
  ) {
    super();
    this.filterQueryBuilder =
      opts?.filterQueryBuilder ?? new FilterQueryBuilder<Entity>(this.repo);
    this.useSoftDelete = opts?.useSoftDelete ?? false;
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
          .create(
            this.EntityClass,
            instanceToPlain(d) as RequiredEntityData<Entity>,
          );
        console.log('Deserializer created entity:', entity);
        return entity;
      })(this.EntityClass);
    }
  }

  get EntityClass(): Class<Entity> {
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName());
    return metadata.class as Class<Entity>;
  }

  /**
   * Query for multiple entities, using a Query from `@nestjs-query/core`.
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
    const qb = this.filterQueryBuilder.select(query);
    // Apply entity-level filters (like soft delete) - must be done before executing
    await qb.applyFilters();
    return qb.getResultList();
  }

  async aggregate(
    filter: Filter<Entity>,
    aggregate: AggregateQuery<Entity>,
  ): Promise<AggregateResponse<Entity>[]> {
    const qb = this.filterQueryBuilder.aggregate({ filter }, aggregate);
    // Apply entity-level filters (like soft delete) - must be done before executing
    await qb.applyFilters();
    const rawResults = await qb.execute<Record<string, unknown>[]>();
    return AggregateBuilder.convertToAggregateResponse(rawResults);
  }

  async count(filter: Filter<Entity>): Promise<number> {
    const qb = this.filterQueryBuilder.select({ filter });
    // Apply entity-level filters (like soft delete) - must be done before executing
    await qb.applyFilters();
    return qb.getCount();
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
  async findById(
    id: string | number,
    opts?: FindByIdOptions<Entity>,
  ): Promise<Entity | undefined> {
    const qb = this.filterQueryBuilder.selectById(id, opts ?? {});
    // Apply entity-level filters (like soft delete) - must be done before executing
    await qb.applyFilters();
    const result = await qb.getSingleResult();
    return result ?? undefined;
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
  async getById(
    id: string | number,
    opts?: GetByIdOptions<Entity>,
  ): Promise<Entity> {
    const entity = await this.findById(id, opts);
    if (!entity) {
      throw new NotFoundException(
        `Unable to find ${this.EntityClass.name} with id: ${id}`,
      );
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
    const entities = await Promise.all(
      records.map((r) => this.ensureIsEntityAndDoesNotExist(r)),
    );
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
    this.ensureIdIsNotPresent(update);
    const entity = await this.getById(id, opts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrap(entity).assign(update as any);
    await this.repo.getEntityManager().flush();
    return entity;
  }

  /**
   * Update multiple entities with a `@nestjs-query/core` Filter.
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

    // Get entities matching the filter
    const entities = await this.query({ filter });

    // Update each entity
    for (const entity of entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrap(entity).assign(update as any);
    }

    await this.repo.getEntityManager().flush();
    return { updatedCount: entities.length };
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
  async deleteOne(
    id: string | number,
    opts?: DeleteOneOptions<Entity>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const em = this.repo.getEntityManager();
    if (this.useSoftDelete) {
      // For soft delete, set the deletedAt field
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrap(entity).assign({ deletedAt: new Date() } as any);
      await em.flush();
    } else {
      await em.remove(entity).flush();
      // Clear the primary key to match TypeORM behavior (sets PK to undefined after deletion)
      const metadata = this.em.getMetadata().get(this.repo.getEntityName());
      const primaryKey = metadata.primaryKeys[0];
      (entity as Record<string, unknown>)[primaryKey] = undefined;
    }
    return entity;
  }

  /**
   * Delete multiple records with a `@nestjs-query/core` `Filter`.
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
    const entities = await this.query({ filter });
    const em = this.repo.getEntityManager();

    if (this.useSoftDelete) {
      for (const entity of entities) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrap(entity).assign({ deletedAt: new Date() } as any);
      }
    } else {
      for (const entity of entities) {
        em.remove(entity);
      }
    }

    await em.flush();
    return { deletedCount: entities.length };
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
  async restoreOne(
    id: string | number,
    opts?: Filterable<Entity>,
  ): Promise<Entity> {
    this.ensureSoftDeleteEnabled();
    // When restoring, we need to find soft-deleted entities, so bypass filters
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName());
    const primaryKey = metadata.primaryKeys[0] as keyof Entity;

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
      throw new NotFoundException(
        `Unable to find ${this.EntityClass.name} with id: ${id}`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrap(entity).assign({ deletedAt: null } as any);
    await em.flush();
    return entity;
  }

  /**
   * Restores multiple records with a `@nestjs-query/core` `Filter`.
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
    // When restoring, we need to find soft-deleted entities, so bypass filters
    const em = this.repo.getEntityManager();
    const whereBuilder = new WhereBuilder<Entity>();
    const whereClause = whereBuilder.build(filter);
    const entities = await em.find(
      this.EntityClass,
      whereClause as FilterQuery<Entity>,
      { filters: false },
    );

    for (const entity of entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrap(entity).assign({ deletedAt: null } as any);
    }

    await em.flush();
    return { updatedCount: entities.length };
  }

  private get em() {
    return this.repo.getEntityManager();
  }

  private async ensureIsEntityAndDoesNotExist(
    e: DeepPartial<Entity>,
  ): Promise<Entity> {
    if (!(e instanceof this.EntityClass)) {
      const entity = this.em.create(
        this.repo.getEntityName(),
        e as RequiredEntityData<Entity>,
      );
      return this.ensureEntityDoesNotExist(entity);
    }
    return this.ensureEntityDoesNotExist(e);
  }

  private async ensureEntityDoesNotExist(e: Entity): Promise<Entity> {
    const metadata = this.em.getMetadata().get(this.repo.getEntityName());
    const primaryKey = metadata.primaryKeys[0];
    const id = (e as Record<string, unknown>)[primaryKey];

    if (id) {
      // Clear the EM to avoid finding stale cached entities after truncate
      this.em.clear();
      const found = await this.repo.findOne({
        [primaryKey]: id,
      } as FilterQuery<Entity>);
      if (found) {
        throw new Error('Entity already exists');
      }
    }
    return e;
  }

  private ensureIdIsNotPresent(e: DeepPartial<Entity>): void {
    const metadata = this.em.getMetadata().get(this.repo.getEntityName());
    const primaryKey = metadata.primaryKeys[0];

    if ((e as Record<string, unknown>)[primaryKey]) {
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
