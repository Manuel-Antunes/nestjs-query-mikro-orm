import type { EntityMetadata, FilterQuery } from '@mikro-orm/core';

export interface QueryBuilder<T = unknown> {
  andWhere?(filter: FilterQuery<T>): this;
  orderBy?(o: Record<string, unknown> | unknown): this;
  groupBy?(field: string): this;
  addSelect?(s: unknown): this;
  mainAlias?: { metadata?: EntityMetadata<T> };
}

export type MinimalQueryBuilder<T = unknown> = QueryBuilder<T>;
