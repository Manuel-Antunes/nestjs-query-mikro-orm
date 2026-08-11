import { Entity, Filter, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { pkName } from './driver';
@Entity({ tableName: 'test_soft_delete_entity' })
@Filter({ name: 'softDelete', cond: { deletedAt: null }, default: true })
export class TestSoftDeleteEntity {
  @PrimaryKey({ name: pkName('test_entity_pk'), type: 'string' })
  testEntityPk!: string;

  @Property({ name: 'string_type', type: 'string' })
  stringType!: string;

  @Property({ name: 'deleted_at', nullable: true, type: 'Date' })
  deletedAt?: Date;
}
