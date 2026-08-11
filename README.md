# nestjs-query-mikro-orm

A [NestJS Query](https://github.com/tripss/nestjs-query) adapter for [MikroORM](https://mikro-orm.io/).

This library provides a seamless integration between NestJS Query and MikroORM, allowing you to build powerful GraphQL APIs with minimal boilerplate.

## Features

- 🚀 Full NestJS Query support with MikroORM
- 📦 Type-safe query building
- 🔍 Advanced filtering and sorting
- 🔗 Relation query support (batched, no N+1)
- 📊 Aggregation queries, with pluggable per-backend strategies
- 🎯 Soft delete support
- ✨ Built with TypeScript
- 📦 Dual-format support (ESM & CommonJS)

## Compatibility

This package supports both **ES Modules (ESM)** and **CommonJS (CJS)** for maximum compatibility across different Node.js environments and bundlers.

- **ESM**: `import { MikroOrmQueryService } from 'nestjs-query-mikro-orm'`
- **CommonJS**: `const { MikroOrmQueryService } = require('nestjs-query-mikro-orm')`

The package automatically detects the import method and serves the appropriate format.

Three entry points are published:

| Import                         | Contains                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| `nestjs-query-mikro-orm`       | the module, the query services, and the aggregation contract |
| `nestjs-query-mikro-orm/sql`   | `SqlAggregateStrategy`                                       |
| `nestjs-query-mikro-orm/mongo` | `MongoAggregateStrategy`                                     |

## Installation

```bash
pnpm add nestjs-query-mikro-orm

# Install peer dependencies if you haven't already
pnpm add @mikro-orm/core @mikro-orm/nestjs @nestjs/common @nestjs/core \
         @ptc-org/nestjs-query-core class-transformer reflect-metadata rxjs
```

### Peer dependencies

Everything this package talks to is a peer dependency, so your application owns the versions and
there is never a second copy of MikroORM or NestJS in the tree.

**Required** — the package does not work without them:

| Package                          | Range           | Why                                                          |
| -------------------------------- | --------------- | ------------------------------------------------------------ |
| `@mikro-orm/core`                | `^7.1.6`        | the ORM itself: entity manager, metadata, filters            |
| `@mikro-orm/nestjs`              | `^7.1.6`        | `getRepositoryToken`, `MikroOrmModule.forFeature`            |
| `@nestjs/common`, `@nestjs/core` | `^10 \|\| ^11`  | dynamic modules, DI, the HTTP exceptions thrown on not-found |
| `@ptc-org/nestjs-query-core`     | `^9.4.0`        | `QueryService`, `Filter`, `AggregateQuery`, assemblers       |
| `class-transformer`              | `^0.5.0`        | serializing entities into DTOs                               |
| `reflect-metadata`, `rxjs`       | `^0.1.13`, `^7` | required by NestJS itself                                    |

**Optional** — only needed for the database-side aggregation strategies, and marked
`peerDependenciesMeta.optional` so package managers will not warn when they are absent:

| Package              | Needed for                                                |
| -------------------- | --------------------------------------------------------- |
| `@mikro-orm/sql`     | `nestjs-query-mikro-orm/sql` — `SqlAggregateStrategy`     |
| `@mikro-orm/mongodb` | `nestjs-query-mikro-orm/mongo` — `MongoAggregateStrategy` |
| `mikro-orm-neo4j`    | `nestjs-query-mikro-orm/neo4j` — `Neo4jAggregateStrategy` |

You almost certainly have one of them already: `@mikro-orm/sql` is what the SQL drivers
(`@mikro-orm/postgresql`, `@mikro-orm/mysql`, `@mikro-orm/sqlite`, …) are built on. Neither is
imported by the main entry point, so an application that never imports the `/sql` or `/mongo`
subpath never resolves them.

## Quick Start

### 1. Setup MikroORM Module

```typescript
import { NestjsQueryMikroOrmModule } from 'nestjs-query-mikro-orm';
import { Module } from '@nestjs/common';
import { UserEntity } from './user.entity';

@Module({
  imports: [NestjsQueryMikroOrmModule.forFeature([UserEntity])],
})
export class UserModule {}
```

`forFeature` also accepts an entity paired with the DTO its query service should expose. Both forms
can be mixed in one call:

```typescript
NestjsQueryMikroOrmModule.forFeature([
  UserEntity, // service typed on the entity
  { entity: OrderEntity, dto: OrderDTO }, // resolved via @Assembler(OrderDTO, OrderEntity)
  { entity: TagEntity, dto: TagDTO, assembler: TagAssembler }, // explicit assembler
]);
```

### Configuring the registered services

The second argument configures the services `forFeature` creates. It is either the MikroORM context
name, as before, or an options object carrying that name alongside the options every registered
service should share:

```typescript
import { SqlAggregateStrategy } from 'nestjs-query-mikro-orm/sql';

NestjsQueryMikroOrmModule.forFeature(
  [UserEntity, OrderEntity, { entity: AuditEntity, useSoftDelete: true }],
  {
    contextName: 'reporting', // optional, same meaning as passing the string directly
    aggregateStrategy: new SqlAggregateStrategy(),
  },
);
```

The strategy reaches all three services; only `AuditEntity` soft deletes. **An entry's own options
win over the shared ones**, so a single entity can opt out of a default the rest share.

Sharing one strategy instance across the call is intended - the strategies hold no per-entity
state, and one per connection is the natural granularity.

`filterQueryBuilder` is not available here: it is typed against one entity and needs that entity's
repository to construct, so it can only be set by a service class that owns both.

### 2. Create Your Entity

```typescript
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class UserEntity {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Property()
  email!: string;

  @Property()
  createdAt: Date = new Date();
}
```

### 3. Use the Query Service

```typescript
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/core';
import { QueryService } from '@ptc-org/nestjs-query-core';
import { MikroOrmQueryService } from 'nestjs-query-mikro-orm';
import { UserEntity } from './user.entity';

@QueryService(UserEntity)
export class UserService extends MikroOrmQueryService<UserEntity> {
  constructor(@InjectRepository(UserEntity) repo: EntityRepository<UserEntity>) {
    super(repo);
  }
}
```

The second constructor argument takes the service options:

```typescript
super(repo, {
  useSoftDelete: true,          // deleteOne/deleteMany set `deletedAt` instead of removing rows
  aggregateStrategy: /* … */,   // see below
  filterQueryBuilder: /* … */,  // replace the filter/sort/paging translation
});
```

## Aggregation strategies

`aggregate()` and `aggregateRelations()` need to answer questions like _"count, sum and group these
rows"_. **How** that is computed is pluggable, because the right answer depends on the backend.

### The default

Nothing to configure: services fall back to `InMemoryAggregateStrategy`, which loads the matching
rows and reduces them in JavaScript. It is correct against every driver MikroORM can talk to,
because it needs nothing from the driver beyond `find` — and that generality is paid for one row at
a time.

Since it has to hold every matching row, an unbounded filter over a large table is a memory hazard
rather than a slow query. Give it a ceiling to turn that into a clear error:

```typescript
import { InMemoryAggregateStrategy } from 'nestjs-query-mikro-orm';

super(repo, { aggregateStrategy: new InMemoryAggregateStrategy({ maxRows: 50_000 }) });
```

### Pushing the work into the database

Two strategies ship behind their own entry points, so the driver package they need is only resolved
by the applications that ask for them:

```typescript
import { SqlAggregateStrategy } from 'nestjs-query-mikro-orm/sql'; // needs @mikro-orm/sql
import { MongoAggregateStrategy } from 'nestjs-query-mikro-orm/mongo'; // needs @mikro-orm/mongodb

@QueryService(UserEntity)
export class UserService extends MikroOrmQueryService<UserEntity> {
  constructor(@InjectRepository(UserEntity) repo: EntityRepository<UserEntity>) {
    super(repo, { aggregateStrategy: new SqlAggregateStrategy() });
  }
}
```

`SqlAggregateStrategy` issues a `GROUP BY`, `MongoAggregateStrategy` a `$group` pipeline stage, and
`Neo4jAggregateStrategy` a Cypher `RETURN` — Cypher groups by whatever is returned and not
aggregated, so there is no `GROUP BY` to emit. Either way only the grouped rows cross the wire
instead of every matching row.

Two things are specific to the Neo4j one. It addresses **entity property names** rather than mapped
column names, because the driver stores nodes keyed on the property. And since Cypher has no
`LIKE`, `like`/`ilike` become regular expression matches. A filter it cannot translate — an
unrecognised operator, or one reaching through a relation, which on a graph means traversing an
edge — throws instead of quietly returning a number computed from a narrower set. The strategy
is shared with the relation query builders, so `aggregateRelations` benefits too — including the
batched form, which groups by the owning key and answers every owner in one round trip.

Measured on 200 owners with 50 relations each (`pnpm bench`, SQLite in memory):

|                                      | in-memory                    | sql                  |
| ------------------------------------ | ---------------------------- | -------------------- |
| aggregate over the owners            | 1.3 ms, 200 rows transported | **0.1 ms, 1 row**    |
| batched aggregate of their relations | 105 ms, 10 000 rows          | **1.0 ms, 200 rows** |

Both issue a single statement — the difference is entirely in how much data comes back and how much
JavaScript runs over it, so the gap widens with volume.

### Choosing per backend

Strategies are passed per service, so nothing is detected implicitly and a single application can
mix them. A convenient pattern is one shared instance per connection:

```typescript
// aggregation.ts
export const AGGREGATE_STRATEGY = new SqlAggregateStrategy();

// user.service.ts
super(repo, { aggregateStrategy: AGGREGATE_STRATEGY });
```

### Writing one for another driver

MikroORM can be extended with drivers this package knows nothing about — Neo4j, DynamoDB, anything
with a custom driver. The contract is exported from the main entry point precisely so you can
implement one:

```typescript
import type { AggregateRecord, AggregateRequest, AggregateStrategy } from 'nestjs-query-mikro-orm';
import {
  aggregateAlias,
  aggregateFunctionFields,
  aggregateGroupByFields,
  columnNameOf,
} from 'nestjs-query-mikro-orm';

export class Neo4jAggregateStrategy implements AggregateStrategy {
  async execute<Entity extends object>(
    request: AggregateRequest<Entity>,
  ): Promise<AggregateRecord[]> {
    const { em, meta, where, aggregate } = request;

    // `aggregateFunctionFields` gives [['COUNT', ['id']], ['SUM', ['total']], …]
    // `aggregateGroupByFields` gives the grouped properties, request extras included
    // `columnNameOf(meta, property)` resolves a property to its stored column
    // key every value with `aggregateAlias(func, property)` / `groupByAlias(property)`
    return /* … */;
  }
}
```

What a strategy has to honour:

- **One record per group**, or exactly one record when nothing is grouped.
- **Keys** come from `aggregateAlias(func, property)` (`COUNT_id`) and `groupByAlias(property)`
  (`GROUP_BY_status`). MongoDB's habit of nesting grouped columns under `_id` is understood too.
- **`request.additionalGroupBy`** must join the grouping and be reported under the same
  `GROUP_BY_<property>` alias. This is what lets the batched relation aggregate answer many owners
  in one query — a strategy that ignores it silently returns wrong results for that path.
- **`COUNT` skips nulls**, matching SQL's `COUNT(column)`.
- **Values may be in whatever currency the backend uses.** Callers run every record through
  `normalizeAggregateRecords`, which coerces them to the types `AggregateResponse` declares —
  `count`/`sum`/`avg` become numbers, and `max`/`min`/`groupBy` keep the property's own runtime
  type. You get that parity for free; do not pre-convert.

The last point is why the shipped strategies stay interchangeable: SQLite reports `MAX` over a
datetime as epoch milliseconds and a grouped boolean as `0`/`1`, MongoDB reports the same two as a
`Date` and a `boolean`. Normalization is what makes the response identical either way.

To prove a new strategy is conformant, add it to `strategiesFor()` in
`__tests__/aggregate/conformance.spec.ts` and to `strategies()` in
`__tests__/aggregate/batch-conformance.spec.ts`. Both run the same assertions against every
strategy; a conformant implementation passes without any test being changed.

## License

MIT

## Author

Manuel Antunes

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the prerequisites, the
available scripts, how to run the suite against MongoDB or Neo4j, and the commit and pull request
conventions.
