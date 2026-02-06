import { Entity, Filter, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'test_soft_delete_entity' })
@Filter({ name: 'softDelete', cond: { deletedAt: null }, default: true })
export class TestSoftDeleteEntity {
  @PrimaryKey({ name: 'test_entity_pk', type: 'string' })
  testEntityPk!: string;

  @Property({ name: 'string_type', type: 'string' })
  stringType!: string;

  @Property({ name: 'deleted_at', nullable: true, type: 'Date' })
  deletedAt?: Date;
}
