import {
  Collection,
  Entity,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { Exclude } from 'class-transformer';

import { RelationOfTestRelationEntity } from './relation-of-test-relation.entity';
import { TestEntityRelationEntity } from './test-entity-relation.entity';
import { TestEntity } from './test.entity';

@Entity({ tableName: 'test_relation' })
export class TestRelation {
  @PrimaryKey({ name: 'test_relation_pk', type: 'string' })
  testRelationPk!: string;

  @Property({ name: 'relation_name', type: 'string' })
  relationName!: string;

  @Property({ name: 'test_entity_id', nullable: true, type: 'string' })
  testEntityId?: string;

  @Property({
    name: 'uni_directional_test_entity_id',
    nullable: true,
    type: 'string',
  })
  uniDirectionalTestEntityId?: string;

  @Exclude()
  @ManyToOne(() => TestEntity, {
    nullable: true,
    deleteRule: 'cascade',
  })
  testEntity?: TestEntity;

  @Exclude()
  @ManyToOne(() => TestEntity, {
    nullable: true,
    deleteRule: 'cascade',
  })
  testEntityUniDirectional?: TestEntity;

  @Exclude()
  @ManyToMany(() => TestEntity, (te) => te.manyTestRelations)
  manyTestEntities = new Collection<TestEntity>(this);

  @Exclude()
  @OneToOne(() => TestEntity, (entity) => entity.oneTestRelation)
  oneTestEntity?: TestEntity;

  @OneToMany(() => TestEntityRelationEntity, (ter) => ter.testRelation)
  testEntityRelation = new Collection<TestEntityRelationEntity>(this);

  @OneToMany(() => RelationOfTestRelationEntity, (ter) => ter.testRelation)
  relationsOfTestRelation = new Collection<RelationOfTestRelationEntity>(this);

  @Property({
    name: 'uni_directional_relation_test_entity_id',
    nullable: true,
    type: 'string',
  })
  relationOfTestRelationId?: string;

  @ManyToOne(() => RelationOfTestRelationEntity, {
    nullable: true,
    deleteRule: 'cascade',
  })
  relationOfTestRelation?: RelationOfTestRelationEntity;
}
