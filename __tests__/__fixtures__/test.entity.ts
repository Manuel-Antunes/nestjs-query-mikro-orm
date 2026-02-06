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

import { TestEntityRelationEntity } from './test-entity-relation.entity';
import { TestRelation } from './test-relation.entity';

@Entity({ tableName: 'test_entity' })
export class TestEntity {
  @PrimaryKey({ name: 'test_entity_pk', type: 'string' })
  testEntityPk!: string;

  @Property({ name: 'string_type', type: 'string' })
  stringType!: string;

  @Property({ name: 'bool_type', type: 'boolean' })
  boolType!: boolean;

  @Property({ name: 'number_type', type: 'number' })
  numberType!: number;

  @Property({ name: 'date_type', type: 'Date' })
  dateType!: Date;

  @Exclude()
  @OneToMany(() => TestRelation, (tr) => tr.testEntity)
  testRelations = new Collection<TestRelation>(this);

  @Exclude()
  @ManyToMany(() => TestRelation, 'manyTestEntities', { owner: true })
  manyTestRelations = new Collection<TestRelation>(this);

  @ManyToMany(() => TestRelation)
  manyToManyUniDirectional = new Collection<TestRelation>(this);

  @Exclude()
  @OneToOne(() => TestRelation, (relation) => relation.oneTestEntity, {
    owner: true,
    nullable: true,
  })
  oneTestRelation?: TestRelation;

  @OneToMany(() => TestEntityRelationEntity, (ter) => ter.testEntity)
  testEntityRelation = new Collection<TestEntityRelationEntity>(this);
}
