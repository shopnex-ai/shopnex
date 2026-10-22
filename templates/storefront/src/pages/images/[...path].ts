// Storeplate's images were served from /images/ before themes had their own assets; shops' saved settings
// may still point there (the call-to-action image's old default)
import type { APIRoute } from 'astro'
import { assetPath } from '../../core/liquid'

export const GET: APIRoute = ({ params, redirect }) => redirect(assetPath('storeplate', params.path ?? ''), 301)
