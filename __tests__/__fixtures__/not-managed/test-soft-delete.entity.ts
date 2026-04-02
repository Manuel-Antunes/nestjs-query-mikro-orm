import { defineEntity } from '@mikro-orm/core';
import { BaseEntity, BaseSchema } from './base.entity';

interface TestSoftDeleteEntityProps {
  stringType: string;
  deletedAt?: Date;
}

export class TestSoftDeleteEntity extends BaseEntity<TestSoftDeleteEntityProps> {
  /* get stringType */ get stringType(): string {
    return this.props.stringType;
  }

  /* get deletedAt */ get deletedAt(): Date | undefined {
    return this.props.deletedAt;
  }

  set deletedAt(deletedAt: Date | undefined) {
    this.props.deletedAt = deletedAt;
  }
}

export const TestSoftDeleteSchema = defineEntity({
  name: 'TestSoftDeleteEntity',
  class: TestSoftDeleteEntity,
  tableName: 'test_soft_delete_entity',
  extends: BaseSchema,

  filters: {
    softDelete: {
      cond: { deletedAt: null },
      default: true,
      name: 'softDelete',
    },
  },
  properties(properties) {
    return {
      id: properties.string().name('test_entity_pk').primary(),
      stringType: properties.string().name('string_type'),
      deletedAt: properties.date().type('Date').name('deleted_at').nullable(),
    };
  },
});
