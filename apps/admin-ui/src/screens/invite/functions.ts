import { createServerFn } from '@tanstack/react-start'
import { getOpenInvitation, userExists } from '@shopnex/tenancy'
import { enabledSocialProviders } from '@shopnex/auth'
import { getAdminContext } from '@/lib/session.functions'

export const loadInvitation = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const [invitation, access] = await Promise.all([getOpenInvitation(id), getAdminContext()])
    if (!invitation) return { invitation: null, session: null, existingUser: false, providers: enabledSocialProviders }
    const existingUser = access.session ? true : await userExists(invitation.email)
    return { invitation, session: access.session, existingUser, providers: enabledSocialProviders }
  })
