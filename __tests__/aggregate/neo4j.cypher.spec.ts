import type { EntityManager, EntityMetadata } from '@mikro-orm/core';
import type { AggregateQuery } from '@ptc-org/nestjs-query-core';
import { describe, expect, it } from 'vitest';

import { Neo4jAggregateStrategy } from '../../src/neo4j';

/**
 * Asserts the Cypher `Neo4jAggregateStrategy` builds, without needing a graph database.
 *
 * `neo4j.strategy.spec.ts` proves the same queries answer correctly against a real Neo4j; this
 * covers the translation itself, including the branches a happy-path integration run never reaches.
 */
interface Movie {
  id: string;
  title: string;
  releasedAt: number;
}

const strategy = new Neo4jAggregateStrategy();

/** The strategy only reads the label off the metadata. */
const meta = { collection: 'movie', className: 'Movie' } as EntityMetadata<Movie>;

interface Captured {
  cypher: string;
  params: Record<string, unknown>;
}

const capture = async (
  aggregate: AggregateQuery<Movie>,
  where: object = {},
  additionalGroupBy?: string[],
): Promise<Captured> => {
  let captured: Captured = { cypher: '', params: {} };
  const em = {
    aggregate: (cypher: string, params: Record<string, unknown>) => {
      captured = { cypher, params };
      return Promise.resolve([]);
    },
  } as unknown as EntityManager;

  await strategy.execute<Movie>({ em, meta, where, aggregate, additionalGroupBy });
  return captured;
};

const COUNT: AggregateQuery<Movie> = { count: [{ field: 'id', args: {} }] };

describe('Neo4jAggregateStrategy: the Cypher it builds', () => {
  it('matches the node label and returns the aggregation', async () => {
    const { cypher } = await capture(COUNT);
    expect(cypher).toBe('MATCH (n:`movie`)\nRETURN count(n.`id`) AS `COUNT_id`');
  });

  it('falls back to the class name when the entity has no collection', async () => {
    const em = {
      aggregate: (cypher: string) => Promise.resolve([{ cypher }]),
    } as unknown as EntityManager;
    const [record] = await strategy.execute<Movie>({
      em,
      meta: { className: 'Movie' } as EntityMetadata<Movie>,
      where: {},
      aggregate: COUNT,
    });
    expect(record.cypher).toContain('MATCH (n:`Movie`)');
  });

  it('addresses the entity property, not the mapped column', async () => {
    // the driver stores nodes keyed on the property name, unlike the SQL and MongoDB strategies
    const { cypher } = await capture({ sum: [{ field: 'releasedAt', args: {} }] });
    expect(cypher).toContain('sum(n.`releasedAt`)');
    expect(cypher).not.toContain('released_at');
  });

  it('lists the grouped properties alongside the aggregations', async () => {
    // Cypher groups by whatever is returned and not aggregated, so there is no GROUP BY to emit
    const { cypher } = await capture({ ...COUNT, groupBy: [{ field: 'title', args: {} }] });
    expect(cypher).toBe(
      'MATCH (n:`movie`)\nRETURN n.`title` AS `GROUP_BY_title`, count(n.`id`) AS `COUNT_id`',
    );
  });

  it('appends additionalGroupBy to the grouping', async () => {
    const { cypher } = await capture(COUNT, {}, ['title']);
    expect(cypher).toContain('n.`title` AS `GROUP_BY_title`');
  });

  it('emits every aggregate function in lower case, as Cypher spells them', async () => {
    const { cypher } = await capture({
      count: [{ field: 'id', args: {} }],
      sum: [{ field: 'releasedAt', args: {} }],
      avg: [{ field: 'releasedAt', args: {} }],
      max: [{ field: 'releasedAt', args: {} }],
      min: [{ field: 'releasedAt', args: {} }],
    });
    ['count(', 'sum(', 'avg(', 'max(', 'min('].forEach((fn) => expect(cypher).toContain(fn));
  });

  it('issues nothing when no function and no grouping was requested', async () => {
    const { cypher } = await capture({});
    expect(cypher).toBe('');
  });

  it('escapes a backtick in an identifier rather than closing it early', async () => {
    const { cypher } = await capture({
      count: [{ field: 'we`ird' as keyof Movie, args: {} }],
    });
    expect(cypher).toContain('n.`we``ird`');
  });

  describe('filters', () => {
    it.each([
      ['eq', { title: { $eq: 'a' } }, 'n.`title` = $p0', { p0: 'a' }],
      ['ne', { title: { $ne: 'a' } }, 'n.`title` <> $p0', { p0: 'a' }],
      ['gt', { releasedAt: { $gt: 1 } }, 'n.`releasedAt` > $p0', { p0: 1 }],
      ['gte', { releasedAt: { $gte: 1 } }, 'n.`releasedAt` >= $p0', { p0: 1 }],
      ['lt', { releasedAt: { $lt: 1 } }, 'n.`releasedAt` < $p0', { p0: 1 }],
      ['lte', { releasedAt: { $lte: 1 } }, 'n.`releasedAt` <= $p0', { p0: 1 }],
      ['in', { releasedAt: { $in: [1, 2] } }, 'n.`releasedAt` IN $p0', { p0: [1, 2] }],
      ['nin', { releasedAt: { $nin: [1] } }, 'NOT n.`releasedAt` IN $p0', { p0: [1] }],
      ['shorthand', { title: 'a' }, 'n.`title` = $p0', { p0: 'a' }],
      ['null shorthand', { title: null }, 'n.`title` IS NULL', {}],
      ['eq null', { title: { $eq: null } }, 'n.`title` IS NULL', {}],
      ['ne null', { title: { $ne: null } }, 'n.`title` IS NOT NULL', {}],
      ['not', { title: { $not: { $eq: 'a' } } }, 'NOT (n.`title` = $p0)', { p0: 'a' }],
    ])('translates %s', async (_name, where, expected, params) => {
      const captured = await capture(COUNT, where);
      expect(captured.cypher).toContain(`WHERE ${expected}`);
      expect(captured.params).toEqual(params);
    });

    it('rewrites a like pattern as a regular expression', async () => {
      const { cypher, params } = await capture(COUNT, { title: { $like: 'a%b_c' } });
      expect(cypher).toContain('n.`title` =~ $p0');
      expect(params).toEqual({ p0: 'a.*b.c' });
    });

    it('makes an ilike pattern case insensitive', async () => {
      const { params } = await capture(COUNT, { title: { $ilike: 'A%' } });
      expect(params).toEqual({ p0: '(?i)A.*' });
    });

    it('escapes regex metacharacters so a literal stays literal', async () => {
      const { params } = await capture(COUNT, { title: { $like: 'a.b+c%' } });
      expect(params).toEqual({ p0: 'a\\.b\\+c.*' });
    });

    it('combines several operators on one property', async () => {
      const { cypher } = await capture(COUNT, { releasedAt: { $gte: 1, $lte: 5 } });
      expect(cypher).toContain('WHERE n.`releasedAt` >= $p0 AND n.`releasedAt` <= $p1');
    });

    it('combines several properties', async () => {
      const { cypher } = await capture(COUNT, { title: { $eq: 'a' }, releasedAt: { $eq: 1 } });
      expect(cypher).toContain('WHERE n.`title` = $p0 AND n.`releasedAt` = $p1');
    });

    it('translates $and', async () => {
      const { cypher } = await capture(COUNT, {
        $and: [{ title: { $eq: 'a' } }, { releasedAt: { $eq: 1 } }],
      });
      expect(cypher).toContain('WHERE (n.`title` = $p0 AND n.`releasedAt` = $p1)');
    });

    it('translates $or', async () => {
      const { cypher } = await capture(COUNT, {
        $or: [{ title: { $eq: 'a' } }, { title: { $eq: 'b' } }],
      });
      expect(cypher).toContain('WHERE (n.`title` = $p0 OR n.`title` = $p1)');
    });

    it('drops an empty $and rather than emitting a dangling clause', async () => {
      const { cypher } = await capture(COUNT, { $and: [] });
      expect(cypher).not.toContain('WHERE');
    });

    it('omits the WHERE for an empty filter', async () => {
      const { cypher } = await capture(COUNT, {});
      expect(cypher).not.toContain('WHERE');
    });

    it('passes a Date through as a parameter', async () => {
      const date = new Date('2020-02-09T00:00:00.000Z');
      const { params } = await capture(COUNT, { releasedAt: date });
      expect(params).toEqual({ p0: date });
    });
  });

  describe('what it refuses rather than guessing', () => {
    it('rejects an operator it cannot translate', async () => {
      await expect(capture(COUNT, { title: { $regexp: 'a' } })).rejects.toThrow(
        /cannot translate the operator \$regexp/,
      );
    });

    it('rejects a top level operator it cannot translate', async () => {
      await expect(capture(COUNT, { $fulltext: 'a' })).rejects.toThrow(
        /cannot translate the operator \$fulltext/,
      );
    });

    it('rejects a filter that reaches through a relation', async () => {
      // traversing an edge is not the same as reading a property, so guessing would be wrong
      await expect(capture(COUNT, { director: { name: { $eq: 'a' } } })).rejects.toThrow(
        /cannot aggregate through a relation filter/,
      );
    });

    it('rejects an empty comparison', async () => {
      await expect(capture(COUNT, { title: {} })).rejects.toThrow(
        /cannot translate an empty comparison/,
      );
    });

    it('refuses an EntityManager that cannot run Cypher', async () => {
      await expect(
        strategy.execute<Movie>({
          em: {} as unknown as EntityManager,
          meta,
          where: {},
          aggregate: COUNT,
        }),
      ).rejects.toThrow(/requires the Neo4j EntityManager/);
    });
  });
});
