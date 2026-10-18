import type { OfficeDataSource } from '@pawoffice/protocol/dashboard'
import { ExampleOfficeDataSource } from './demoSource.ts'
import { codingOfficeExample } from './codingExample.ts'

export function createOfficeDataSource(): OfficeDataSource {
  return new ExampleOfficeDataSource(new Date(), codingOfficeExample)
}
