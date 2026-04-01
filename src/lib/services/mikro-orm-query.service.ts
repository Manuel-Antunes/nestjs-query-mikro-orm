import type { EntityName, FilterQuery, RequiredEntityData } from '@mikro-orm/core';
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
    this.filterQueryBuilder = opts?.filterQueryBuilder ?? new FilterQueryBuilder<Entity>(this.repo);
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
          .merge(this.EntityClass, d as RequiredEntityData<Entity>) as Entity;
        return entity;
      })(this.EntityClass);
    }
  }

  get EntityClass(): Class<Entity> {
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName() as unknown as EntityName<any>);
    return metadata.class as Class<Entity>;
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
    const em = this.repo.getEntityManager();
    let where: FilterQuery<Entity> | undefined = filterQuery as FilterQuery<Entity> | undefined;
    if (this.useSoftDelete) {
      const deletedFilter = { deletedAt: null } as FilterQuery<Entity>;
      where = where ? ({ $and: [where, deletedFilter] } as FilterQuery<Entity>) : deletedFilter;
    }
    return em.find(this.EntityClass, where ?? {}, options as Record<string, unknown>);
  }

  async aggregate(
    filter: Filter<Entity>,
    aggregate: AggregateQuery<Entity>,
  ): Promise<AggregateResponse<Entity>[]> {
    // Build find options for the filter and fetch matching rows, then compute aggregates in-memory
    const { filterQuery } = this.filterQueryBuilder.buildFindOptions({ filter } as Query<Entity>);
    const em = this.repo.getEntityManager();
    let where: FilterQuery<Entity> | undefined = filterQuery as FilterQuery<Entity> | undefined;
    if (this.useSoftDelete) {
      const deletedFilter = { deletedAt: null } as FilterQuery<Entity>;
      where = where ? ({ $and: [where, deletedFilter] } as FilterQuery<Entity>) : deletedFilter;
    }
    const rows = (await em.find(this.EntityClass, where ?? {})) as unknown[];

    // Compute aggregates similar to RelationQueryBuilder (database-agnostic)
    const aggs = aggregate;
    const groupBy = aggs.groupBy ?? [];
    const records: Record<string, unknown>[] = [];
    const makeAggKey = (func: string, field: string) => `${func}_${field}`;
    const makeGroupKey = (field: string) => `GROUP_BY_${field}`;

    const isNumeric = (v: unknown) => typeof v === 'number' || v instanceof Date;

    if (groupBy.length === 0) {
      const out: Record<string, unknown> = {};
      const computeField = (fn: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN', field: string) => {
        const values = rows
          .map((r) => (r as Record<string, unknown>)[field])
          .filter((v) => v !== undefined && v !== null);
        if (fn === 'COUNT') {
          out[makeAggKey('COUNT', field)] = values.length;
          return;
        }
        if (values.length === 0) {
          out[makeAggKey(fn, field)] = null;
          return;
        }
        if (fn === 'SUM' || fn === 'AVG') {
          const nums = values
            .map((v) => (v instanceof Date ? v.getTime() : Number(v)))
            .filter((n) => !Number.isNaN(n));
          const sum = nums.reduce((s: number, v: number) => s + v, 0);
          out[makeAggKey(fn, field)] = fn === 'SUM' ? sum : nums.length ? sum / nums.length : null;
          return;
        }
        if (fn === 'MAX') {
          if (values.every(isNumeric)) {
            const nums = values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));
            out[makeAggKey('MAX', field)] = Math.max(...nums);
          } else {
            out[makeAggKey('MAX', field)] = values.reduce((a, b) =>
              String(a) > String(b) ? a : b,
            );
          }
          return;
        }
        if (fn === 'MIN') {
          if (values.every(isNumeric)) {
            const nums = values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));
            out[makeAggKey('MIN', field)] = Math.min(...nums);
          } else {
            out[makeAggKey('MIN', field)] = values.reduce((a, b) =>
              String(a) < String(b) ? a : b,
            );
          }
          return;
        }
      };
      // Only add aggregate selects for functions that were requested
      // @ts-expect-error - TypeScript is not correctly inferring the types here
      (aggs.count ?? []).forEach((f: keyof Entity) => computeField('COUNT', String(f)));
      // @ts-expect-error - TypeScript is not correctly inferring the types here
      (aggs.sum ?? []).forEach((f: keyof Entity) => computeField('SUM', String(f)));
      // @ts-expect-error - TypeScript is not correctly inferring the types here
      (aggs.avg ?? []).forEach((f: keyof Entity) => computeField('AVG', String(f)));
      // @ts-expect-error - TypeScript is not correctly inferring the types here
      (aggs.max ?? []).forEach((f: keyof Entity) => computeField('MAX', String(f)));
      // @ts-expect-error - TypeScript is not correctly inferring the types here
      (aggs.min ?? []).forEach((f: keyof Entity) => computeField('MIN', String(f)));

      records.push(out);
    } else {
      const groups = new Map<string, unknown[]>();
      rows.forEach((r) => {
        const key = groupBy
          .map((g) => JSON.stringify((r as Record<string, unknown>)[String(g)]))
          .join('|');
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      });

      groups.forEach((groupRows, key) => {
        const parts = key.split('|').map((p) => JSON.parse(p));
        const out: Record<string, unknown> = {};
        groupBy.forEach((g, i) => {
          const val = parts[i];
          out[makeGroupKey(String(g))] = typeof val === 'boolean' ? (val ? 1 : 0) : val;
        });

        const computeField = (fn: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN', field: string) => {
          const values = groupRows
            .map((r) => (r as Record<string, unknown>)[field])
            .filter((v) => v !== undefined && v !== null);
          if (fn === 'COUNT') {
            out[makeAggKey('COUNT', field)] = values.length;
            return;
          }
          if (values.length === 0) {
            out[makeAggKey(fn, field)] = null;
            return;
          }
          if (fn === 'SUM' || fn === 'AVG') {
            const nums = values
              .map((v) => (v instanceof Date ? v.getTime() : Number(v)))
              .filter((n) => !Number.isNaN(n));
            const sum = nums.reduce((s: number, v: number) => s + v, 0);
            out[makeAggKey(fn, field)] =
              fn === 'SUM' ? sum : nums.length ? sum / nums.length : null;
            return;
          }
          if (fn === 'MAX') {
            if (values.every(isNumeric)) {
              const nums = values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));
              out[makeAggKey('MAX', field)] = Math.max(...nums);
            } else {
              out[makeAggKey('MAX', field)] = values.reduce((a, b) =>
                String(a) > String(b) ? a : b,
              );
            }
            return;
          }
          if (fn === 'MIN') {
            if (values.every(isNumeric)) {
              const nums = values.map((v) => (v instanceof Date ? v.getTime() : Number(v)));
              out[makeAggKey('MIN', field)] = Math.min(...nums);
            } else {
              out[makeAggKey('MIN', field)] = values.reduce((a, b) =>
                String(a) < String(b) ? a : b,
              );
            }
            return;
          }
        };
        // @ts-expect-error - TypeScript is not correctly inferring the types here
        (aggs.count ?? []).forEach((f: keyof Entity) => computeField('COUNT', String(f)));
        // @ts-expect-error - TypeScript is not correctly inferring the types here
        (aggs.sum ?? []).forEach((f: keyof Entity) => computeField('SUM', String(f)));
        // @ts-expect-error - TypeScript is not correctly inferring the types here
        (aggs.avg ?? []).forEach((f: keyof Entity) => computeField('AVG', String(f)));
        // @ts-expect-error - TypeScript is not correctly inferring the types here
        (aggs.max ?? []).forEach((f: keyof Entity) => computeField('MAX', String(f)));
        // @ts-expect-error - TypeScript is not correctly inferring the types here
        (aggs.min ?? []).forEach((f: keyof Entity) => computeField('MIN', String(f)));

        records.push(out);
      });
    }

    return records.map((r) => AggregateBuilder.convertToAggregateResponse([r])[0]);
  }

  async count(filter: Filter<Entity>): Promise<number> {
    const { filterQuery } = this.filterQueryBuilder.buildFindOptions({ filter } as Query<Entity>);
    const em = this.repo.getEntityManager();
    let where: FilterQuery<Entity> | undefined = filterQuery as FilterQuery<Entity> | undefined;
    if (this.useSoftDelete) {
      const deletedFilter = { deletedAt: null } as FilterQuery<Entity>;
      where = where ? ({ $and: [where, deletedFilter] } as FilterQuery<Entity>) : deletedFilter;
    }
    return em.count(this.EntityClass, where ?? {});
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
    const metadata = this.em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<any>);
    const primaryKey = metadata.primaryKeys[0] as keyof Entity;
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
    const dateWithClearUndefined = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    ) as DeepPartial<Entity>;
    this.ensureIdIsNotPresent(dateWithClearUndefined);
    const entity = await this.getById(id, opts);

    wrap(entity).assign(dateWithClearUndefined as unknown as Partial<Entity> as any);
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
  async deleteOne(id: string | number, opts?: DeleteOneOptions<Entity>): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const em = this.repo.getEntityManager();
    if (this.useSoftDelete) {
      // For soft delete, set the deletedAt field
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrap(entity).assign({ deletedAt: new Date() } as any);
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
  async restoreOne(id: string | number, opts?: Filterable<Entity>): Promise<Entity> {
    this.ensureSoftDeleteEnabled();
    // When restoring, we need to find soft-deleted entities, so bypass filters
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName() as unknown as EntityName<any>);
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
      throw new NotFoundException(`Unable to find ${this.EntityClass.name} with id: ${id}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrap(entity).assign({ deletedAt: null } as any);
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
    // When restoring, we need to find soft-deleted entities, so bypass filters
    const em = this.repo.getEntityManager();
    const whereBuilder = new WhereBuilder<Entity>();
    const whereClause = whereBuilder.build(filter);
    const entities = await em.find(this.EntityClass, whereClause as FilterQuery<Entity>, {
      filters: false,
    });

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

  private async ensureIsEntityAndDoesNotExist(e: DeepPartial<Entity>): Promise<Entity> {
    if (!(e instanceof this.EntityClass)) {
      const entity = this.em.create(
        this.repo.getEntityName() as unknown as EntityName<any>,
        e as RequiredEntityData<Entity>,
      );
      return this.ensureEntityDoesNotExist(entity as Entity);
    }
    return this.ensureEntityDoesNotExist(e);
  }

  private async ensureEntityDoesNotExist(e: Entity): Promise<Entity> {
    const metadata = this.em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<any>);
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
    const metadata = this.em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<any>);
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
