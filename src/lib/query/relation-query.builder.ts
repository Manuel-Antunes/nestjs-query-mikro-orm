import type { EntityProperty, FilterQuery } from '@mikro-orm/core';
import type { EntityRepository, QueryBuilder } from '@mikro-orm/knex';
import type { AggregateQuery, Query } from '@nestjs-query/core';

import { FilterQueryBuilder } from './filter-query.builder';

export type EntityIndexRelation<Relation> = Relation & {
  __nestjsQuery__entityIndex__: number;
};

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
      relationMeta.type,
    ) as unknown as EntityRepository<Relation>;
    this.filterQueryBuilder = new FilterQueryBuilder<Relation>(relationRepo);
  }

  /**
   * Builds and returns a QueryBuilder for selecting relations without executing it.
   * This is useful for testing or when you need to inspect/modify the query before execution.
   */
  select(entity: Entity, query: Query<Relation>): QueryBuilder<Relation> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const relationEntityName = relationMeta.type;
    const entityMeta = em.getMetadata().get(this.repo.getEntityName());
    const entityPrimaryKey = entityMeta.primaryKeys[0];
    const entityId = (entity as Record<string, unknown>)[entityPrimaryKey];

    let qb = em.createQueryBuilder<Relation>(relationEntityName) as QueryBuilder<Relation>;

    // For owned 1:1 relations where FK might not be loaded, use a JOIN
    if (relationMeta.kind === '1:1' && relationMeta.owner && relationMeta.inversedBy) {
      // Check if FK is available
      const fkFieldName = relationMeta.joinColumns?.[0] || relationMeta.fieldNames?.[0];
      const fkValue = fkFieldName ? (entity as Record<string, unknown>)[fkFieldName] : undefined;

      if (fkValue === undefined) {
        // FK not loaded, need to JOIN through the parent entity
        const parentAlias = 'parent';
        const relationAlias = qb.alias; // Use the QB's auto-generated alias (usually 't0')

        // Join parent entity via the inverse relationship and filter by parent's PK
        qb = qb.leftJoin(`${relationAlias}.${relationMeta.inversedBy}`, parentAlias).where({
          [`${parentAlias}.${entityPrimaryKey}`]: entityId,
        } as FilterQuery<Relation>);

        // Apply additional filters
        qb = this.filterQueryBuilder.applyFilter(qb, query.filter);
        qb = this.filterQueryBuilder.applyPaging(qb, query.paging);
        qb = this.filterQueryBuilder.applySorting(qb, query.sorting);

        return qb;
      }
    }

    // Build the where condition based on the relation type
    const whereCondition = this.buildWhereCondition(entity, relationMeta);
    qb = qb.where(whereCondition as FilterQuery<Relation>);

    // Apply additional filters from query
    qb = this.filterQueryBuilder.applyFilter(qb, query.filter);
    qb = this.filterQueryBuilder.applyPaging(qb, query.paging);
    qb = this.filterQueryBuilder.applySorting(qb, query.sorting);

    return qb;
  }

  /**
   * Executes the select query and returns the results.
   */
  async selectAndExecute(entity: Entity, query: Query<Relation>): Promise<Relation[]> {
    const qb = this.select(entity, query);
    return qb.getResultList() as Promise<Relation[]>;
  }

  async count(entity: Entity, query: Query<Relation>): Promise<number> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const relationEntityName = relationMeta.type;

    let qb = em.createQueryBuilder<Relation>(relationEntityName) as QueryBuilder<Relation>;

    // Build the where condition based on the relation type
    const whereCondition = this.buildWhereCondition(entity, relationMeta);
    qb = qb.where(whereCondition as FilterQuery<Relation>);

    // Apply additional filters from query
    qb = this.filterQueryBuilder.applyFilter(qb, query.filter);

    return qb.getCount();
  }

  async aggregate(
    entity: Entity,
    query: Query<Relation>,
    aggregateQuery: AggregateQuery<Relation>,
  ): Promise<Record<string, unknown>[]> {
    const relationMeta = this.getRelationMeta();
    const em = this.repo.getEntityManager();
    const relationEntityName = relationMeta.type;

    let qb = em.createQueryBuilder<Relation>(relationEntityName) as QueryBuilder<Relation>;

    // Build the where condition
    const whereCondition = this.buildWhereCondition(entity, relationMeta);
    qb = qb.where(whereCondition as FilterQuery<Relation>);

    // Apply aggregate, filter, sorting, and grouping
    qb = this.filterQueryBuilder.applyAggregate(qb, aggregateQuery);
    qb = this.filterQueryBuilder.applyFilter(qb, query.filter);
    qb = this.filterQueryBuilder.applyAggregateSorting(qb, aggregateQuery.groupBy);
    qb = this.filterQueryBuilder.applyGroupBy(qb, aggregateQuery.groupBy);

    return qb.execute<Record<string, unknown>[]>();
  }

  private buildWhereCondition(
    entity: Entity,
    relationMeta: EntityProperty<Entity>,
  ): Record<string, unknown> {
    const em = this.repo.getEntityManager();
    const entityMeta = em.getMetadata().get(this.repo.getEntityName());
    const relationEntityMeta = em.getMetadata().get(relationMeta.type as string);
    const entityPrimaryKey = entityMeta.primaryKeys[0];
    const relationPrimaryKey = relationEntityMeta.primaryKeys[0];
    const entityId = (entity as Record<string, unknown>)[entityPrimaryKey];

    // Determine the relation type and build appropriate condition
    if (relationMeta.kind === 'm:1') {
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
          return keyLower.endsWith('id') && relationNameLower.includes(keyLower.replace(/id$/, ''));
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

      return { [relationPrimaryKey]: fkValue };
    }

    if (relationMeta.kind === '1:1') {
      // One-to-One: Depends on which side owns the relationship
      if (relationMeta.owner) {
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

        // 3. If still undefined, we need to query via the inverse side
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
    const metadata = em.getMetadata().get(this.repo.getEntityName());
    const relationProp = metadata.properties[this.relation];

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
    const relationEntityMeta = em.getMetadata().get(relationMeta.type as string);

    return relationEntityMeta.primaryKeys.map((pk) => {
      const prop = relationEntityMeta.properties[pk];
      return {
        propertyName: pk,
        columnName: prop.fieldNames?.[0] || pk,
      };
    });
  }
}
