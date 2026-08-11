/**
 * Database-side aggregation for MongoDB.
 *
 * Kept behind its own entry point so the main package never reaches for the MongoDB EntityManager:
 * the strategy is only loaded by the applications that ask for it.
 */
export { MongoAggregateStrategy } from './lib/aggregate/mongo.strategy';
