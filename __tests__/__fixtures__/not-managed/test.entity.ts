import { Collection, defineEntity, ref } from '@mikro-orm/core';
import { Exclude } from 'class-transformer';

import { BaseEntity, BaseSchema } from './base.entity';
import { TestEntityRelationEntity, TestEntityRelationSchema } from './test-entity-relation.entity';
import { TestRelation, TestRelationSchema } from './test-relation.entity';

interface TestEntityProps {
  stringType: string;
  boolType: boolean;
  numberType: number;
  dateType: Date;
  testRelations?: TestRelation[];
  manyTestRelations?: TestRelation[];
  manyToManyUniDirectional?: TestRelation[];
  oneTestRelation?: TestRelation;
  testEntityRelation?: TestEntityRelationEntity[];
}

export class TestEntity extends BaseEntity<TestEntityProps> {
  get stringType(): string {
    return this.props.stringType;
  }
  set stringType(val: string) {
    this.props.stringType = val;
  }
  get boolType(): boolean {
    return this.props.boolType;
  }
  set boolType(val: boolean) {
    this.props.boolType = val;
  }
  get numberType(): number {
    return this.props.numberType;
  }
  set numberType(val: number) {
    this.props.numberType = val;
  }
  get dateType(): Date {
    return this.props.dateType;
  }
  set dateType(val: Date) {
    this.props.dateType = val;
  }

  @Exclude()
  readonly testRelations = new Collection<TestRelation>(this, this.props.testRelations);

  @Exclude()
  readonly manyTestRelations = new Collection<TestRelation>(this, this.props.manyTestRelations);

  readonly manyToManyUniDirectional = new Collection<TestRelation>(
    this,
    this.props.manyToManyUniDirectional,
  );

  @Exclude()
  get oneTestRelation() {
    return ref(this.props.oneTestRelation);
  }

  set oneTestRelation(value) {
    if (value === null) {
      this.props.oneTestRelation = undefined;
      return;
    }
    if (value !== undefined) {
      this.props.oneTestRelation = value.$ ?? value;
    }
  }

  testEntityRelation = new Collection<TestEntityRelationEntity>(
    this,
    this.props.testEntityRelation,
  );
}

export const TestSchema = defineEntity({
  name: 'TestEntity',
  class: TestEntity,
  tableName: 'test_entity',
  extends: BaseSchema,

  properties(properties) {
    return {
      id: properties.string().name('test_entity_pk').primary(),
      stringType: properties.string().name('string_type'),
      boolType: properties.boolean().name('bool_type'),
      numberType: properties.integer().name('number_type'),
      dateType: properties.datetime().name('date_type'),
      testRelations: () => properties.oneToMany(TestRelationSchema).mappedBy('testEntity'),
      manyTestRelations: () =>
        properties.manyToMany(TestRelationSchema).inversedBy('manyTestEntities'),
      manyToManyUniDirectional: () => properties.manyToMany(TestRelationSchema),
      oneTestRelation: () => properties.oneToOne(TestRelationSchema).nullable(),
      testEntityRelation: () =>
        properties.oneToMany(TestEntityRelationSchema).mappedBy('testEntity'),
    };
  },
});
