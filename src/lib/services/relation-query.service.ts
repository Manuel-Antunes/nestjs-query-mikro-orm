import type { Collection, EntityName, EntityProperty, FilterQuery } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/knex';
import type {
  AggregateQuery,
  AggregateResponse,
  Class,
  Filter,
  FindRelationOptions,
  GetByIdOptions,
  ModifyRelationOptions,
  Query,
} from '@nestjs-query/core';
import { wrap } from '@mikro-orm/core';
import { AssemblerFactory } from '@nestjs-query/core';

import type { FilterQueryBuilder } from '../query/index';
import { AggregateBuilder, RelationQueryBuilder } from '../query/index';

interface RelationMetadata {
  kind: 'm:1' | '1:m' | '1:1' | 'm:n';
  type: string;
  entity: () => EntityName<unknown>;
}

/**
 * Base class to house relations loading.
 * @internal
 */
export abstract class RelationQueryService<Entity extends object> {
  abstract filterQueryBuilder: FilterQueryBuilder<Entity>;

  abstract EntityClass: Class<Entity>;

  abstract repo: EntityRepository<Entity>;

  abstract getById(id: string | number, opts?: GetByIdOptions<Entity>): Promise<Entity>;

  /**
   * Query for an array of relations.
   * @param RelationClass - The class to serialize the relations into.
   * @param dto - The dto to query relations for.
   * @param relationName - The name of relation to query for.
   * @param query - A query to filter, page and sort relations.
   */
  async queryRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity,
    query: Query<Relation>,
  ): Promise<Relation[]>;

  /**
   * Query for relations for an array of Entities. This method will return a map with the Entity as the key and the relations as the value.
   * @param RelationClass - The class of the relation.
   * @param relationName - The name of the relation to load.
   * @param entities - the dtos to find relations for.
   * @param query - A query to use to filter, page, and sort relations.
   */
  async queryRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    query: Query<Relation>,
  ): Promise<Map<Entity, Relation[]>>;

  async queryRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity | Entity[],
    query: Query<Relation>,
  ): Promise<Relation[] | Map<Entity, Relation[]>> {
    if (Array.isArray(dto)) {
      return this.batchQueryRelations(RelationClass, relationName, dto, query);
    }
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    return assembler.convertAsyncToDTOs(
      relationQueryBuilder.selectAndExecute(dto, assembler.convertQuery(query)),
    );
  }

  async aggregateRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    filter: Filter<Relation>,
    aggregate: AggregateQuery<Relation>,
  ): Promise<Map<Entity, AggregateResponse<Relation>[]>>;

  async aggregateRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity,
    filter: Filter<Relation>,
    aggregate: AggregateQuery<Relation>,
  ): Promise<AggregateResponse<Relation>[]>;

  async aggregateRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity | Entity[],
    filter: Filter<Relation>,
    aggregate: AggregateQuery<Relation>,
  ): Promise<AggregateResponse<Relation>[] | Map<Entity, AggregateResponse<Relation>[]>> {
    if (Array.isArray(dto)) {
      return this.batchAggregateRelations(RelationClass, relationName, dto, filter, aggregate);
    }
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    const rawResults = await relationQueryBuilder.aggregate(
      dto,
      assembler.convertQuery({ filter }),
      assembler.convertAggregateQuery(aggregate),
    );
    const aggResponse = AggregateBuilder.convertToAggregateResponse(rawResults);
    return aggResponse.map((agg) => {
      const res = assembler.convertAggregateResponse(agg);
      return res;
    });
  }

  async countRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    filter: Filter<Relation>,
  ): Promise<Map<Entity, number>>;

  async countRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity,
    filter: Filter<Relation>,
  ): Promise<number>;

  async countRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity | Entity[],
    filter: Filter<Relation>,
  ): Promise<number | Map<Entity, number>> {
    if (Array.isArray(dto)) {
      return this.batchCountRelations(RelationClass, relationName, dto, filter);
    }
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    return relationQueryBuilder.count(dto, assembler.convertQuery({ filter }));
  }

  /**
   * Find a relation for an array of Entities. This will return a Map where the key is the Entity and the value is to
   * relation or undefined if not found.
   * @param RelationClass - the class of the relation
   * @param relationName - the name of the relation to load.
   * @param dtos - the dtos to find the relation for.
   * @param opts - Additional options
   */
  async findRelation<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dtos: Entity[],
    opts?: FindRelationOptions<Relation>,
  ): Promise<Map<Entity, Relation | undefined>>;

  /**
   * Finds a single relation.
   * @param RelationClass - The class to serialize the relation into.
   * @param dto - The dto to find the relation for.
   * @param relationName - The name of the relation to query for.
   * @param opts - Additional options
   */
  async findRelation<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity,
    opts?: FindRelationOptions<Relation>,
  ): Promise<Relation | undefined>;

  async findRelation<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dto: Entity | Entity[],
    opts?: FindRelationOptions<Relation>,
  ): Promise<(Relation | undefined) | Map<Entity, Relation | undefined>> {
    if (Array.isArray(dto)) {
      return this.batchFindRelations(RelationClass, relationName, dto, opts);
    }
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    const relations = await relationQueryBuilder.selectAndExecute(dto, {
      filter: opts?.filter,
      paging: { limit: 1 },
    });
    const relationEntity = relations[0];
    return relationEntity ? assembler.convertToDTO(relationEntity) : undefined;
  }

  /**
   * Add a single relation.
   * @param id - The id of the entity to add the relation to.
   * @param relationName - The name of the relation to query for.
   * @param relationIds - The ids of relations to add.
   * @param opts - Addition options
   */
  async addRelations<Relation extends object>(
    relationName: string,
    id: string | number,
    relationIds: (string | number)[],
    opts?: ModifyRelationOptions<Entity, Relation>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const relations = await this.getRelations<Relation>(
      relationName,
      relationIds,
      opts?.relationFilter,
    );
    if (!this.foundAllRelations(relationIds, relations)) {
      throw new Error(`Unable to find all ${relationName} to add to ${this.EntityClass.name}`);
    }

    // Get the collection and add relations
    const collection = (entity as Record<string, unknown>)[relationName] as Collection<Relation>;
    if (collection && typeof collection.add === 'function') {
      for (const relation of relations) {
        collection.add(relation);
      }
      await this.repo.getEntityManager().flush();
    }

    return entity;
  }

  /**
   * Set the relations on the entity.
   *
   * @param id - The id of the entity to set the relation on.
   * @param relationName - The name of the relation to query for.
   * @param relationIds - The ids of the relation to set on the entity. If the relationIds is empty all relations
   * will be removed.
   * @param opts - Additional options
   */
  async setRelations<Relation extends object>(
    relationName: string,
    id: string | number,
    relationIds: (string | number)[],
    opts?: ModifyRelationOptions<Entity, Relation>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const relations = await this.getRelations<Relation>(
      relationName,
      relationIds,
      opts?.relationFilter,
    );
    if (relationIds.length) {
      if (!this.foundAllRelations(relationIds, relations)) {
        throw new Error(`Unable to find all ${relationName} to set on ${this.EntityClass.name}`);
      }
    }

    // Get the collection and set relations
    const collection = (entity as Record<string, unknown>)[relationName] as Collection<Relation>;
    if (collection && typeof collection.set === 'function') {
      // Initialize the collection before modifying it (MikroORM requirement)
      await collection.init();
      collection.set(relations);
      await this.repo.getEntityManager().flush();
    }

    return entity;
  }

  /**
   * Set the relation on the entity.
   *
   * @param id - The id of the entity to set the relation on.
   * @param relationName - The name of the relation to query for.
   * @param relationId - The id of the relation to set on the entity.
   * @param opts - Additional options
   */
  async setRelation<Relation extends object>(
    relationName: string,
    id: string | number,
    relationId: string | number,
    opts?: ModifyRelationOptions<Entity, Relation>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const relation = (
      await this.getRelations<Relation>(relationName, [relationId], opts?.relationFilter)
    )[0];
    if (!relation) {
      throw new Error(`Unable to find ${relationName} to set on ${this.EntityClass.name}`);
    }

    // Set the relation directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrap(entity).assign({ [relationName]: relation } as any);
    await this.repo.getEntityManager().flush();

    return entity;
  }

  /**
   * Removes multiple relations.
   * @param id - The id of the entity to add the relation to.
   * @param relationName - The name of the relation to query for.
   * @param relationIds - The ids of the relations to add.
   * @param opts - Additional options
   */
  async removeRelations<Relation extends object>(
    relationName: string,
    id: string | number,
    relationIds: (string | number)[],
    opts?: ModifyRelationOptions<Entity, Relation>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const relations = await this.getRelations<Relation>(
      relationName,
      relationIds,
      opts?.relationFilter,
    );
    if (!this.foundAllRelations(relationIds, relations)) {
      throw new Error(`Unable to find all ${relationName} to remove from ${this.EntityClass.name}`);
    }

    // Get the collection and remove relations
    const collection = (entity as Record<string, unknown>)[relationName] as Collection<Relation>;
    if (collection && typeof collection.remove === 'function') {
      // Initialize the collection before modifying it (MikroORM requirement)
      await collection.init();
      for (const relation of relations) {
        collection.remove(relation);
      }
      await this.repo.getEntityManager().flush();
    }

    return entity;
  }

  /**
   * Remove the relation on the entity.
   *
   * @param id - The id of the entity to set the relation on.
   * @param relationName - The name of the relation to query for.
   * @param relationId - The id of the relation to set on the entity.
   */
  async removeRelation<Relation extends object>(
    relationName: string,
    id: string | number,
    relationId: string | number,
    opts?: ModifyRelationOptions<Entity, Relation>,
  ): Promise<Entity> {
    const entity = await this.getById(id, opts);
    const relation = (
      await this.getRelations<Relation>(relationName, [relationId], opts?.relationFilter)
    )[0];
    if (!relation) {
      throw new Error(`Unable to find ${relationName} to remove from ${this.EntityClass.name}`);
    }
    const meta = this.getRelationMeta(relationName);
    if (meta.kind === '1:1' || meta.kind === 'm:1') {
      // For single relations, set both the relation and the FK field to null
      // The FK field often follows the pattern relationNameId (e.g., testEntityId for testEntity)
      const fkFieldName = `${relationName}Id`;
      const assignData: Record<string, null> = { [relationName]: null };

      // Also clear the FK field if it exists on the entity
      if (fkFieldName in (entity as Record<string, unknown>)) {
        assignData[fkFieldName] = null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wrap(entity).assign(assignData as any);
    } else {
      // For collections, remove the relation
      const collection = (entity as Record<string, unknown>)[relationName] as Collection<Relation>;
      if (collection && typeof collection.remove === 'function') {
        // Initialize the collection before modifying it (MikroORM requirement)
        await collection.init();
        collection.remove(relation);
      }
    }

    await this.repo.getEntityManager().flush();
    return entity;
  }

  getRelationQueryBuilder<Relation extends object>(
    name: string,
  ): RelationQueryBuilder<Entity, Relation> {
    return new RelationQueryBuilder(this.repo, name);
  }

  /**
   * Query for an array of relations for multiple dtos.
   * @param RelationClass - The class to serialize the relations into.
   * @param entities - The entities to query relations for.
   * @param relationName - The name of relation to query for.
   * @param query - A query to filter, page or sort relations.
   */
  private async batchQueryRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    query: Query<Relation>,
  ): Promise<Map<Entity, Relation[]>> {
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    const convertedQuery = assembler.convertQuery(query);

    const results = new Map<Entity, Relation[]>();

    // Process each entity and collect its relations
    await Promise.all(
      entities.map(async (entity) => {
        const relations = await relationQueryBuilder.selectAndExecute(entity, convertedQuery);
        const relationDtos = assembler.convertToDTOs(relations);
        // Only add to map if there are relations (undefined for entities with no relations)
        if (relationDtos.length > 0) {
          results.set(entity, relationDtos);
        }
      }),
    );

    return results;
  }

  /**
   * Query for an array of relations for multiple dtos.
   * @param RelationClass - The class to serialize the relations into.
   * @param entities - The entities to query relations for.
   * @param relationName - The name of relation to query for.
   * @param query - A query to filter, page or sort relations.
   */
  private async batchAggregateRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    filter: Filter<Relation>,
    aggregate: AggregateQuery<Relation>,
  ): Promise<Map<Entity, AggregateResponse<Relation>[]>> {
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    const convertedQuery = assembler.convertQuery({ filter });

    const results = new Map<Entity, AggregateResponse<Relation>[]>();

    await Promise.all(
      entities.map(async (entity) => {
        const rawAggregates = await relationQueryBuilder.aggregate(
          entity,
          convertedQuery,
          assembler.convertAggregateQuery(aggregate),
        );
        const aggResponse = AggregateBuilder.convertToAggregateResponse(rawAggregates);
        results.set(
          entity,
          aggResponse.map((agg) => assembler.convertAggregateResponse(agg)),
        );
      }),
    );

    return results;
  }

  /**
   * Count the number of relations for multiple dtos.
   * @param RelationClass - The class to serialize the relations into.
   * @param entities - The entities to query relations for.
   * @param relationName - The name of relation to query for.
   * @param filter - The filter to apply to the relation query.
   */
  private async batchCountRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    entities: Entity[],
    filter: Filter<Relation>,
  ): Promise<Map<Entity, number>> {
    const assembler = AssemblerFactory.getAssembler(
      RelationClass,
      this.getRelationEntity(relationName),
    );
    const relationQueryBuilder = this.getRelationQueryBuilder<Relation>(relationName);
    const convertedQuery = assembler.convertQuery({ filter });

    const results = new Map<Entity, number>();

    await Promise.all(
      entities.map(async (entity) => {
        const count = await relationQueryBuilder.count(entity, convertedQuery);
        results.set(entity, count);
      }),
    );

    return results;
  }

  /**
   * Query for a relation for multiple dtos.
   * @param RelationClass - The class to serialize the relations into.
   * @param dtos - The dto to query relations for.
   * @param relationName - The name of relation to query for.
   * @param query - A query to filter, page or sort relations.
   */
  private async batchFindRelations<Relation extends object>(
    RelationClass: Class<Relation>,
    relationName: string,
    dtos: Entity[],
    opts?: FindRelationOptions<Relation>,
  ): Promise<Map<Entity, Relation | undefined>> {
    const batchResults = await this.batchQueryRelations(RelationClass, relationName, dtos, {
      paging: { limit: 1 },
      filter: opts?.filter,
    });
    const results = new Map<Entity, Relation | undefined>();
    // Only add entities that have matching relations to the map
    batchResults.forEach((relations, dto) => {
      // get just the first one
      if (relations?.[0]) {
        results.set(dto, relations[0]);
      }
    });
    return results;
  }

  private getRelationMeta(relationName: string): RelationMetadata {
    const em = this.repo.getEntityManager();
    const metadata = em.getMetadata().get(this.repo.getEntityName());
    const relationMeta = metadata.relations.find((r: EntityProperty) => r.name === relationName);
    if (!relationMeta) {
      throw new Error(`Unable to find relation ${relationName} on ${this.EntityClass.name}`);
    }
    return {
      kind: relationMeta.kind as 'm:1' | '1:m' | '1:1' | 'm:n',
      type: relationMeta.type,
      entity: relationMeta.entity,
    };
  }

  private getRelationEntity(relationName: string): Class<unknown> {
    const relationMeta = this.getRelationMeta(relationName);
    return relationMeta.entity() as Class<unknown>;
  }

  private async getRelations<Relation extends object>(
    relationName: string,
    ids: (string | number)[],
    filter?: Filter<Relation>,
  ): Promise<Relation[]> {
    const em = this.repo.getEntityManager();
    const relationMeta = this.getRelationMeta(relationName);
    const RelationEntity = relationMeta.entity() as EntityName<Relation>;
    const relationMetadata = em.getMetadata().get(RelationEntity);
    const primaryKey = relationMetadata.primaryKeys[0];

    // Build the filter with both the IDs and any additional filter
    const idFilter = { [primaryKey]: { $in: ids } } as FilterQuery<Relation>;

    if (filter) {
      // Combine with additional filter if provided
      const whereBuilder = this.filterQueryBuilder.whereBuilder;
      const additionalFilter = whereBuilder.build(
        filter as Filter<Entity>,
      ) as FilterQuery<Relation>;
      return em.find(RelationEntity, {
        $and: [idFilter, additionalFilter],
      } as FilterQuery<Relation>);
    }

    return em.find(RelationEntity, idFilter);
  }

  private foundAllRelations<Relation>(
    relationIds: (string | number)[],
    relations: Relation[],
  ): boolean {
    return new Set([...relationIds]).size === relations.length;
  }
}
