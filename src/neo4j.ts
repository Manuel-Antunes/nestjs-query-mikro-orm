/**
 * Database-side aggregation for Neo4j, via
 * [`mikro-orm-neo4j`](https://www.npmjs.com/package/mikro-orm-neo4j).
 *
 * Kept behind its own entry point so the main package never reaches for the Neo4j EntityManager:
 * the strategy is only loaded by the applications that ask for it.
 */
export { Neo4jAggregateStrategy } from './lib/aggregate/neo4j.strategy';
