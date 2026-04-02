import { defineEntity } from '@mikro-orm/core';

interface AddressEmbeddedProps {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export class AddressEmbedded {
  private props: AddressEmbeddedProps;

  constructor(props: AddressEmbeddedProps) {
    this.props = props;
  }

  get street(): string {
    return this.props.street;
  }

  set street(val: string) {
    this.props.street = val;
  }

  get city(): string {
    return this.props.city;
  }

  set city(val: string) {
    this.props.city = val;
  }

  get state(): string {
    return this.props.state;
  }

  set state(val: string) {
    this.props.state = val;
  }

  get zipCode(): string {
    return this.props.zipCode;
  }

  set zipCode(val: string) {
    this.props.zipCode = val;
  }
}

export const AddressEmbeddedSchema = defineEntity({
  name: 'AddressEmbedded',
  class: AddressEmbedded,
  embeddable: true,
  properties(properties) {
    return {
      street: properties.string().name('street'),
      city: properties.string().name('city'),
      state: properties.string().name('state'),
      zipCode: properties.string().name('zip_code'),
    };
  },
});
