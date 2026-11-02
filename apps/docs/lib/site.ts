// Where the project's website (download page, install script, compose file) lives.
// Set NEXT_PUBLIC_SITE_URL at build time to point the docs at a different domain.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shopnex.ai').replace(/\/$/, '')
