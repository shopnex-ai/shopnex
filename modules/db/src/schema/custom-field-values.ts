// What a record stores per custom field: text, choice and file as a string, number, boolean. The column
// (`custom_fields`) is on products, orders and customers, so its type lives here; the field definitions belong to
// @shopnex/custom-fields.
export type CustomFieldValue = string | number | boolean
export type CustomFieldValues = Record<string, CustomFieldValue>
