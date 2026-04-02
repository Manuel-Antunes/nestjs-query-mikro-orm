import { defineEntity, ref } from '@mikro-orm/core';
import { Exclude } from 'class-transformer';

import { BaseEntity, BaseSchema } from './base.entity';
import { TestRelation, TestRelationSchema } from './test-relation.entity';
import { TestEntity, TestSchema as TestEntitySchema } from './test.entity';

interface TestEntityRelationEntityProps {
  testRelation?: TestRelation;
  testEntity?: TestEntity;
}

export class TestEntityRelationEntity extends BaseEntity<TestEntityRelationEntityProps> {
  @Exclude()
  testRelation = ref(this.props?.testRelation);

  @Exclude()
  testEntity = ref(this.props?.testEntity);
}

export const TestEntityRelationSchema = defineEntity({
  name: 'TestEntityRelationEntity',
  class: TestEntityRelationEntity,
  extends: BaseSchema,
  tableName: 'test_entity_relation_entity',

  properties(properties) {
    return {
      testRelation: () => properties.manyToOne(TestRelationSchema).nullable(),
      testEntity: () => properties.manyToOne(TestEntitySchema).nullable(),
    };
  },
});
