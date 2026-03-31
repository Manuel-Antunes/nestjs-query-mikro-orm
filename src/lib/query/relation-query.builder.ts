import type { EntityProperty, FilterQuery, EntityRepository, EntityName } from '@mikro-orm/core';
import type { AggregateQuery, Query } from '@ptc-org/nestjs-query-core';

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
    return (await em.find(
      RelationEntity as unknown as EntityName<any>,
      finalWhere as unknown as FilterQuery<Relation>,
      findOptions as Record<string, unknown>,
    )) as Relation[];
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
    return em.count(
      RelationEntity as unknown as EntityName<any>,
      finalWhere as unknown as FilterQuery<Relation>,
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
    const rows = (await em.find(
      RelationEntity as unknown as EntityName<any>,
      finalWhere as unknown as FilterQuery<Relation>,
    )) as unknown[];

    // compute aggregates in-memory
    const aggs = aggregateQuery;
    const groupBy = aggs.groupBy ?? [];

    type RawAgg = Record<string, unknown>;
    const makeAggKey = (func: string, field: string) => `${func}_${field}`;
    const makeGroupKey = (field: string) => `GROUP_BY_${field}`;

    const records: RawAgg[] = [];

    const isNumeric = (v: unknown) => typeof v === 'number' || v instanceof Date;

    if (groupBy.length === 0) {
      const out: RawAgg = {};
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
        // SUM and AVG only for numeric values
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

      (aggs.count ?? []).forEach((f: keyof Relation) => computeField('COUNT', String(f)));
      (aggs.sum ?? []).forEach((f: keyof Relation) => computeField('SUM', String(f)));
      (aggs.avg ?? []).forEach((f: keyof Relation) => computeField('AVG', String(f)));
      (aggs.max ?? []).forEach((f: keyof Relation) => computeField('MAX', String(f)));
      (aggs.min ?? []).forEach((f: keyof Relation) => computeField('MIN', String(f)));

      records.push(out);
    } else {
      // Group rows by groupBy fields values
      const groups = new Map<string, unknown[]>();
      rows.forEach((r) => {
        const keyParts = groupBy.map((g) =>
          JSON.stringify((r as Record<string, unknown>)[String(g)]),
        );
        const key = keyParts.join('|');
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      });

      groups.forEach((groupRows, key) => {
        const parts = key.split('|').map((p) => JSON.parse(p));
        const out: RawAgg = {};
        groupBy.forEach((g, i) => {
          const val = parts[i];
          // Normalize boolean group values to 0/1 to match SQL behavior in tests
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

        (aggs.count ?? []).forEach((f: keyof Relation) => computeField('COUNT', String(f)));
        (aggs.sum ?? []).forEach((f: keyof Relation) => computeField('SUM', String(f)));
        (aggs.avg ?? []).forEach((f: keyof Relation) => computeField('AVG', String(f)));
        (aggs.max ?? []).forEach((f: keyof Relation) => computeField('MAX', String(f)));
        (aggs.min ?? []).forEach((f: keyof Relation) => computeField('MIN', String(f)));

        records.push(out);
      });
    }

    return records;
  }

  private buildWhereCondition(
    entity: Entity,
    relationMeta: EntityProperty<Entity>,
  ): Record<string, unknown> {
    const em = this.repo.getEntityManager();
    const entityMeta = em
      .getMetadata()
      .get(this.repo.getEntityName() as unknown as EntityName<any>);
    const relationEntityMeta = em
      .getMetadata()
      .get(relationMeta.type as unknown as EntityName<any>);
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
    const metadata = em.getMetadata().get(this.repo.getEntityName() as unknown as EntityName<any>);
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
    const relationEntityMeta = em
      .getMetadata()
      .get(relationMeta.type as unknown as EntityName<any>);

    return relationEntityMeta.primaryKeys.map((pk) => {
      const prop = relationEntityMeta.properties[pk];
      return {
        propertyName: pk,
        columnName: prop.fieldNames?.[0] || pk,
      };
    });
  }
}
