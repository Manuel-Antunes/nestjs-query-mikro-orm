/**
 * Database-side aggregation for the SQL drivers.
 *
 * Kept behind its own entry point so the main package never reaches for a SQL EntityManager: the
 * strategy is only loaded by the applications that ask for it.
 */
export { SqlAggregateStrategy } from './lib/aggregate/sql.strategy';
