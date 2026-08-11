export const TEST_DRIVER = process.env.TEST_DRIVER ?? 'sqlite';

export const IS_MONGO = TEST_DRIVER === 'mongo';

/**
 * MikroORM's Mongo driver requires every entity's primary key to map to the
 * `_id` field, otherwise metadata discovery throws
 * `... has wrong field name, '_id' is required in current driver`.
 *
 * For SQL drivers we keep the descriptive column names so the generated SQL
 * (and the fixtures) stay readable. This helper returns `_id` when running the
 * Mongo suite and the original SQL column name otherwise.
 */
export const pkName = (sqlName: string): string => (IS_MONGO ? '_id' : sqlName);
