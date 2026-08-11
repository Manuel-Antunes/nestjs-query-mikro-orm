import type { AnyEntity, EntityName, EntityRepository } from '@mikro-orm/core';
import type { FactoryProvider } from '@nestjs/common';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import type { Assembler, Class } from '@ptc-org/nestjs-query-core';
import {
  AssemblerFactory,
  AssemblerQueryService,
  getQueryServiceToken,
} from '@ptc-org/nestjs-query-core';

import { MikroOrmQueryService } from './services';

/**
 * Registers an entity whose query service should speak a DTO rather than the entity itself.
 *
 * Pass only `entity` - or the entity on its own - to get a service typed on the entity. Adding a
 * `dto` wraps that service so callers exchange DTOs, using the assembler registered for the pair
 * with `@Assembler(DTO, Entity)`, or a pass-through one when the pair has none. Pass `assembler`
 * to name the class explicitly instead of going through the registry.
 */
export interface EntityServiceOptions<DTO extends object = object, Entity extends object = object> {
  entity: EntityName<Entity>;
  dto?: Class<DTO>;
  assembler?: Class<Assembler<DTO, Entity>>;
}

/**
 * An entity, or an entity paired with the DTO its query service should expose.
 */
export type EntityServiceDefinition = EntityName<AnyEntity> | EntityServiceOptions;

/**
 * Checks one entry of a `forFeature` list against the DTO/entity pair that entry itself declares.
 *
 * `Assembler` is invariant in its DTO/entity pair, so a heterogeneous list has no single element
 * type that accepts every concrete assembler - the upstream packages resolve that by typing such
 * lists as `any`. Validating each entry against its own inferred pair keeps the assembler slot
 * typed instead.
 */
export type ValidEntityServiceDefinition<T> =
  T extends EntityServiceOptions<infer DTO, infer Entity>
    ? EntityServiceOptions<DTO, Entity>
    : EntityName<AnyEntity>;

/** A `forFeature` list, with every entry validated against its own pair. */
export type EntityServiceDefinitions<Defs extends readonly unknown[]> = Defs & {
  [K in keyof Defs]: ValidEntityServiceDefinition<Defs[K]>;
};

/**
 * `EntityName` covers strings and `EntitySchema` instances as well as classes, so options are
 * recognised by their `entity` key - which no `EntityName` carries.
 */
export function isEntityServiceOptions(
  definition: EntityServiceDefinition,
): definition is EntityServiceOptions {
  return typeof definition === 'object' && definition !== null && 'entity' in definition;
}

/**
 * Reads the entity out of a definition, whichever of the two forms it takes.
 */
export function getDefinitionEntity(definition: EntityServiceDefinition): EntityName<AnyEntity> {
  return isEntityServiceOptions(definition)
    ? (definition.entity as EntityName<AnyEntity>)
    : definition;
}

function createMikroOrmQueryServiceProvider<DTO extends object, Entity extends object>(
  EntityClass: EntityName<Entity>,
  contextName?: string,
  DTOClass?: Class<DTO>,
  AssemblerClass?: Class<Assembler<DTO, Entity>>,
): FactoryProvider {
  return {
    // the token is derived from the class name; `EntityName` also admits a bare string, which the
    // helper cannot key on, so registering such an entity requires the options form with a `dto`
    provide: getQueryServiceToken((DTOClass ?? EntityClass) as { name: string }),
    useFactory(repo: EntityRepository<Entity>) {
      const queryService = new MikroOrmQueryService(repo);

      if (AssemblerClass) {
        return new AssemblerQueryService(new AssemblerClass(), queryService);
      }

      if (DTOClass) {
        // `getAssembler` falls back to a pass-through assembler when the DTO/entity pair was never
        // registered, so an unannotated DTO still gets a working service instead of an error.
        const assembler = AssemblerFactory.getAssembler(
          DTOClass,
          EntityClass as unknown as Class<Entity & object>,
        );
        return new AssemblerQueryService(
          assembler as unknown as Assembler<DTO, Entity>,
          queryService,
        );
      }

      return queryService;
    },
    inject: [getRepositoryToken(EntityClass, contextName)],
  };
}

export const createMikroOrmQueryServiceProviders = <const Defs extends readonly unknown[]>(
  definitions: EntityServiceDefinitions<Defs>,
  contextName?: string,
): FactoryProvider[] =>
  (definitions as readonly EntityServiceDefinition[]).map((definition) =>
    isEntityServiceOptions(definition)
      ? createMikroOrmQueryServiceProvider(
          definition.entity,
          contextName,
          definition.dto,
          definition.assembler,
        )
      : createMikroOrmQueryServiceProvider(definition, contextName),
  );
