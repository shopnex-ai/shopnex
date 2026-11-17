// The tables every module points at live in @shopnex/core; they are re-exported here so `schema.shops` and
// `@shopnex/db/schema` keep working for every importer
export * from '@shopnex/core/schema'
export * from './channels'
export * from './catalog'
export * from './customers'
export * from './orders'
export * from './cart'
export * from './checkout'
export * from './email'
export * from './custom-field-values'
