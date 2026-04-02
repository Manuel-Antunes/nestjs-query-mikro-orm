import { defineEntity, ref } from '@mikro-orm/core';
import { Exclude } from 'class-transformer';

import { TestRelation, TestRelationSchema } from './test-relation.entity';
import { BaseEntity, BaseSchema } from './base.entity';

interface RelationOfTestRelationEntityProps {
  relationName: string;
  testRelation?: TestRelation;
}

export class RelationOfTestRelationEntity extends BaseEntity<RelationOfTestRelationEntityProps> {
  get relationName(): string {
    return this.props.relationName;
  }

  @Exclude()
  get testRelation() {
    return ref(this.props.testRelation);
  }

  set testRelation(value) {
    if (value === null) {
      this.props.testRelation = undefined;
      return;
    }
    if (value !== undefined) {
      this.props.testRelation = value.$ ?? value;
    }
  }
}

export const RelationOfTestRelationSchema = defineEntity({
  name: 'RelationOfTestRelationEntity',
  class: RelationOfTestRelationEntity,
  extends: BaseSchema,

  tableName: 'relation_of_test_relation_entity',
  properties(properties) {
    return {
      relationName: properties.string().name('relation_name'),
      testRelation: () => properties.manyToOne(TestRelationSchema).ref().nullable(),
    };
  },
});
