// Safe to import from client code (no server deps)
export const SOCIAL_PROVIDERS = ['google', 'github'] as const
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]
