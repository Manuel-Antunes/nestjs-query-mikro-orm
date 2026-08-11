import { defineEntity } from '@mikro-orm/core';

export const BaseSchema = defineEntity({
  abstract: true,
  name: 'Entity',
  forceConstructor: true,
  properties(p) {
    return {
      id: p.uuid().primary().getter(),
      createdAt: p
        .datetime()
        .getter()
        .onCreate((entity) => {
          return entity?._createdAt ?? new Date();
        }),
      updatedAt: p
        .datetime()
        .getter()
        .onCreate((entity) => {
          return entity?._updatedAt ?? new Date();
        })
        .onUpdate(() => new Date()),
    };
  },
});

export type JSON<Props = object, BaseProps = object> = Required<BaseProps> & Props;

import { wrap } from '@mikro-orm/core';
import { instanceToPlain } from 'class-transformer';
import { v4 as uuidV4 } from 'uuid';

export interface EntityProps {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEntity<Props = object> {
  get id(): string;
  update(newProps: Partial<Props>): void;
}
type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};
export type EntityJson<Props = object> = JSON<Props, EntityProps>;

export abstract class BaseEntity<
  Props = object,
  Json extends EntityJson = EntityJson<Props>,
> implements IEntity<Props> {
  protected readonly _id: string;
  protected readonly props: Mutable<Props>;
  protected _createdAt: Date;
  protected _updatedAt: Date;

  constructor(props: Props, id?: string) {
    this.props = props;
    this._id = id ?? uuidV4();
    if (!id) {
      this._createdAt = new Date();
      this._updatedAt = new Date();
    } else {
      // an entity rebuilt from a persisted row carries its own timestamps in the props
      const timestamps = props as Partial<EntityProps>;
      this._createdAt = timestamps.createdAt ?? new Date();
      this._updatedAt = timestamps.updatedAt ?? new Date();
    }
  }

  get id() {
    return this._id;
  }
  update(newProps: Partial<Omit<Props, 'createdAt' | 'updatedAt'>>): void {
    // the keys come from the caller's patch, so the writes go through an index-signature view
    const patch = newProps as Record<string, unknown>;
    const self = this as unknown as Record<string, unknown>;
    const props = this.props as Record<string, unknown>;

    for (const key of Object.keys(patch)) {
      const value = patch[key];
      if (value !== undefined) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key);
        if (descriptor?.set) {
          // If there's a setter, use it
          self[key] = value;
        } else {
          // Otherwise, directly update props
          props[key] = value;
        }
      }
    }
  }

  equals(entity: BaseEntity): boolean {
    if (entity === null || entity === undefined) {
      return false;
    }
    if (this === entity) {
      return true;
    }
    if (!(entity instanceof BaseEntity)) {
      return false;
    }
    return this._id === entity._id;
  }

  toJSON(groups?: string[]): Json {
    const json = instanceToPlain(this, {
      excludeExtraneousValues: true,
      enableImplicitConversion: true,
      exposeDefaultValues: true,
      groups,
    }) as Json;
    const jsonWithRemovedEmptyObjects = Object.fromEntries(
      Object.entries(json as object).filter(
        ([, value]) =>
          !(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0
          ),
      ),
    ) as Json;
    const wrapped = wrap(this, true);
    const ormJson = 'toObject' in wrapped ? wrapped.toObject() : {};

    const data = {
      ...(ormJson as JSON),
      ...(jsonWithRemovedEmptyObjects as JSON),
    } as Json;

    return data;
  }

  static cast<P, T extends BaseEntity<object, EntityJson>, S extends T>(
    this: new (props: P, id?: string) => S,
    entity: T,
    extraProps?: Partial<P>,
  ): S {
    if (entity instanceof this) {
      return entity as S;
    }

    // `props` is protected, so reaching it from the static side needs a structural view
    const sourceProps = (entity as unknown as { props: P }).props;
    const mergedProps = extraProps ? { ...sourceProps, ...extraProps } : sourceProps;

    return new this(mergedProps, entity.id) as S;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  set createdAt(value: Date) {
    this._createdAt = value;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  set updatedAt(value: Date) {
    this._updatedAt = value;
  }
}
