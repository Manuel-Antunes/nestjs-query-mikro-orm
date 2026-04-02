import { Collection, defineEntity, ref } from '@mikro-orm/core';
import { Exclude } from 'class-transformer';

import {
  RelationOfTestRelationEntity,
  RelationOfTestRelationSchema,
} from './relation-of-test-relation.entity';
import { BaseEntity, BaseSchema } from './base.entity';
import { TestEntity, TestSchema } from './test.entity';
import { TestEntityRelationEntity, TestEntityRelationSchema } from './test-entity-relation.entity';

interface TestRelationProps {
  relationName: string;
  testEntityId?: string | null;
  testEntity?: TestEntity;
  testEntityUniDirectional?: TestEntity;
  manyTestEntities?: TestEntity[];
  oneTestEntity?: TestEntity;
  testEntityRelation?: TestEntityRelationEntity[];
  relationsOfTestRelation?: RelationOfTestRelationEntity[];
  relationOfTestRelation?: RelationOfTestRelationEntity;
}

export class TestRelation extends BaseEntity<TestRelationProps> {
  get relationName(): string {
    return this.props.relationName;
  }

  set relationName(value: string) {
    this.props.relationName = value;
  }

  get testEntityId(): string | null | undefined {
    if (this.props.testEntityId !== undefined) {
      return this.props.testEntityId;
    }
    if (this.props.testEntity === null) {
      return null;
    }
    return this.props.testEntity?.id || this.testEntity?.id;
  }

  set testEntityId(value: string | null | undefined) {
    this.props.testEntityId = value;
  }

  @Exclude()
  get testEntity() {
    return ref(this.props.testEntity);
  }

  set testEntity(value) {
    if (value === null) {
      this.props.testEntity = null as unknown as TestEntity;
      this.props.testEntityId = null;
      return;
    }
    if (value !== undefined) {
      const entityValue = value.$ ?? value;
      this.props.testEntity = entityValue;
      this.props.testEntityId = entityValue?.id;
    }
  }

  @Exclude()
  get testEntityUniDirectional() {
    return ref(this.props.testEntityUniDirectional);
  }

  set testEntityUniDirectional(value) {
    if (value === null) {
      this.props.testEntityUniDirectional = undefined;
      return;
    }
    if (value !== undefined) {
      this.props.testEntityUniDirectional = value.$ ?? value;
    }
  }

  @Exclude()
  readonly manyTestEntities = new Collection<TestEntity>(this, this.props.manyTestEntities);

  @Exclude()
  readonly oneTestEntity = ref(this.props.oneTestEntity);

  testEntityRelation = new Collection<TestEntityRelationEntity>(
    this,
    this.props.testEntityRelation,
  );

  relationsOfTestRelation = new Collection<RelationOfTestRelationEntity>(
    this,
    this.props.relationsOfTestRelation,
  );

  get relationOfTestRelation() {
    return ref(this.props.relationOfTestRelation);
  }

  set relationOfTestRelation(value) {
    if (value === null) {
      this.props.relationOfTestRelation = undefined;
      return;
    }
    if (value !== undefined) {
      this.props.relationOfTestRelation = value.$ ?? value;
    }
  }
}

export const TestRelationSchema = defineEntity({
  name: 'TestRelation',
  class: TestRelation,
  tableName: 'test_relation',
  extends: BaseSchema,
  properties(properties) {
    return {
      id: properties.string().name('test_relation_pk').primary(),
      relationName: properties.string().name('relation_name'),
      testEntity: () => properties.manyToOne(TestSchema).nullable(),
      testEntityUniDirectional: () => properties.manyToOne(TestSchema).nullable(),
      manyTestEntities: () => properties.manyToMany(TestSchema).mappedBy('manyTestRelations'),
      oneTestEntity: () => properties.oneToOne(TestSchema).mappedBy('oneTestRelation'),
      testEntityRelation: () =>
        properties.oneToMany(TestEntityRelationSchema).mappedBy('testRelation'),
      relationsOfTestRelation: () =>
        properties.oneToMany(RelationOfTestRelationSchema).mappedBy('testRelation'),
    };
  },
});
