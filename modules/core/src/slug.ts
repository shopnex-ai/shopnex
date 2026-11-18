// What a URL handle looks like (products, collections, channels, pages): lower case letters and digits, single hyphens. Pure, so every module can use it.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
