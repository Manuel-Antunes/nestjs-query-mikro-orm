import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { TestRelation } from './test-relation.entity';

@Entity({ tableName: 'relation_of_test_relation_entity' })
export class RelationOfTestRelationEntity {
  @PrimaryKey({ name: 'test_relation_pk', type: 'string' })
  id!: string;

  @Property({ name: 'relation_name', type: 'string' })
  relationName!: string;

  @Property({ name: 'test_relation_id', type: 'string' })
  testRelationId!: string;

  @ManyToOne(() => TestRelation, {
    nullable: true,
    deleteRule: 'cascade',
  })
  testRelation?: TestRelation;
}
