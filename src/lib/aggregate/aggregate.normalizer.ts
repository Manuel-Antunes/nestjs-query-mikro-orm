import type { EntityMetadata, EntityProperty } from '@mikro-orm/core';

import type { AggregateRecord } from './aggregate.strategy';

/** Matches the aliases the strategies report their columns under. */
const ALIAS_REGEXP = /^(AVG|SUM|COUNT|MAX|MIN|GROUP_BY)_(.*)$/i;

/** Buckets whose value is a count or a computed number, whatever the column's own type is. */
const NUMERIC_BUCKETS = new Set(['count', 'sum', 'avg']);

/**
 * Coerces the values a strategy reported to the types `AggregateResponse` declares.
 *
 * Each backend answers in its own currency, and the differences are real: SQLite hands back a
 * `MAX` over a datetime column as epoch milliseconds and a grouped boolean as `0`/`1`, MongoDB
 * hands back the same two as a `Date` and a `boolean`, and the in-memory reduction produces
 * whatever JavaScript comparison left behind. Without this step the shape of an aggregate response
 * would depend on the driver underneath, which is the one thing a pluggable strategy must not do.
 *
 * The target is what `AggregateResponse<DTO>` already promises: `count`/`sum`/`avg` are numbers,
 * and `max`/`min`/`groupBy` keep the property's own runtime type.
 */
export const normalizeAggregateRecords = <Entity extends object>(
  records: AggregateRecord[],
  meta: EntityMetadata<Entity>,
): AggregateRecord[] => records.map((record) => normalizeRecord(record, meta));

const normalizeRecord = <Entity extends object>(
  record: AggregateRecord,
  meta: EntityMetadata<Entity>,
): AggregateRecord =>
  Object.fromEntries(
    Object.entries(record).map(([alias, value]) => {
      // MongoDB nests the grouped columns under `_id`; normalize them in place.
      if (alias === '_id' && value && typeof value === 'object' && !(value instanceof Date)) {
        return [alias, normalizeRecord(value as AggregateRecord, meta)];
      }

      const match = ALIAS_REGEXP.exec(alias);
      if (!match) {
        return [alias, value];
      }

      const [bucket, property] = match.slice(1);
      return [alias, coerce(value, bucket.toLowerCase(), meta.properties[property as never])];
    }),
  );

const coerce = (value: unknown, bucket: string, prop?: EntityProperty): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  // A COUNT is a number even over a text column, and SUM/AVG are numbers even over dates.
  if (NUMERIC_BUCKETS.has(bucket)) {
    return toNumber(value);
  }

  if (isDateProperty(prop)) {
    return toDate(value);
  }

  if (isBooleanProperty(prop)) {
    // SQL reports booleans as 0/1
    return typeof value === 'boolean' ? value : Boolean(toNumber(value));
  }

  if (isNumberProperty(prop)) {
    return toNumber(value);
  }

  return value;
};

const toNumber = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value);

const toDate = (value: unknown): Date | unknown => {
  if (value instanceof Date) {
    return value;
  }
  // epoch milliseconds from SQLite, an ISO string from the drivers that store dates as text
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? value : date;
};

const runtimeTypeOf = (prop?: EntityProperty): string =>
  String(prop?.runtimeType ?? prop?.type ?? '').toLowerCase();

const isDateProperty = (prop?: EntityProperty): boolean =>
  ['date', 'datetime', 'timestamp'].includes(runtimeTypeOf(prop));

const isBooleanProperty = (prop?: EntityProperty): boolean =>
  ['boolean', 'bool'].includes(runtimeTypeOf(prop));

const isNumberProperty = (prop?: EntityProperty): boolean =>
  ['number', 'int', 'integer', 'bigint', 'float', 'double', 'decimal', 'smallint'].includes(
    runtimeTypeOf(prop),
  );
