import type { EntityManager, EntityMetadata, MikroORM } from '@mikro-orm/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeTestConnection, createTestConnection } from '../__fixtures__/connection.fixture';
import { IS_MONGO } from '../__fixtures__/driver';
import { TestEntity } from '../__fixtures__/test.entity';
import { SqlAggregateStrategy } from '../../src/sql';

/**
 * The behaviour of `SqlAggregateStrategy` against real data is covered by the conformance suites;
 * this covers what those cannot reach - the statement it builds, and what it does when handed an
 * EntityManager that is not a SQL one.
 */
describe.skipIf(IS_MONGO)('SqlAggregateStrategy', () => {
  let orm: MikroORM;
  const strategy = new SqlAggregateStrategy();

  beforeEach(async () => {
    orm = await createTestConnection();
  });
  afterEach(closeTestConnection);

  const meta = (): EntityMetadata<TestEntity> => orm.em.getMetadata().get(TestEntity);

  it('refuses an EntityManager that cannot build queries', async () => {
    const notSql = {} as unknown as EntityManager;

    await expect(
      strategy.execute<TestEntity>({
        em: notSql,
        meta: meta(),
        where: {},
        aggregate: { count: [{ field: 'testEntityPk', args: {} }] },
      }),
    ).rejects.toThrow(/requires a SQL EntityManager/);
  });

  it('returns nothing when no function and no grouping was requested', async () => {
    // nothing to select means there is no statement worth issuing
    await expect(
      strategy.execute<TestEntity>({
        em: orm.em.fork(),
        meta: meta(),
        where: {},
        aggregate: {},
      }),
    ).resolves.toEqual([]);
  });

  it('addresses the database column, not the property name', async () => {
    let statements: string[] = [];
    const logged = await createTestConnection({
      logger: (message: string) => statements.push(message),
    });
    // the schema creation logs too; only the aggregate statement is of interest
    statements = [];

    await strategy.execute<TestEntity>({
      em: logged.em.fork(),
      meta: logged.em.getMetadata().get(TestEntity),
      where: {},
      aggregate: {
        groupBy: [{ field: 'boolType', args: {} }],
        count: [{ field: 'testEntityPk', args: {} }],
      },
    });

    const select = statements
      // the logger wraps statements in ANSI colour codes
      // eslint-disable-next-line no-control-regex
      .map((s) => s.replace(/\[\d+m/g, ''))
      .find((s) => /\bselect\b/i.test(s));

    expect(select).toBeDefined();
    // `boolType` is stored as `bool_type`, `testEntityPk` as `test_entity_pk`
    expect(select).toContain('bool_type');
    expect(select).toContain('COUNT(');
    expect(select).toContain('test_entity_pk');
    expect(select).toMatch(/group by/i);
    // the aliases are what `convertToAggregateResponse` reads back
    expect(select).toContain('GROUP_BY_boolType');
    expect(select).toContain('COUNT_testEntityPk');
  });
});
