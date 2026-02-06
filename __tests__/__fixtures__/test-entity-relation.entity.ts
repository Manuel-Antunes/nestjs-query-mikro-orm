import { Entity, ManyToOne, PrimaryKey, PrimaryKeyProp } from '@mikro-orm/core';

import { TestRelation } from './test-relation.entity';
import { TestEntity } from './test.entity';

@Entity({ tableName: 'test_entity_relation_entity' })
export class TestEntityRelationEntity {
  [PrimaryKeyProp]?: ['testRelationId', 'testEntityId'];

  @PrimaryKey({ name: 'test_relation_id', type: 'string' })
  testRelationId!: string;

  @PrimaryKey({ name: 'test_entity_id', type: 'string' })
  testEntityId!: string;

  @ManyToOne(() => TestRelation, { nullable: true })
  testRelation?: TestRelation;

  @ManyToOne(() => TestEntity, { nullable: true })
  testEntity?: TestEntity;
}
