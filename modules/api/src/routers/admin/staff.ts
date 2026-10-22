import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { INVITATION_EXPIRES_IN_DAYS } from '@shopnex/auth/roles'
import { staffService } from '@shopnex/tenancy'
import { shopManager } from '../../orpc'
import { staffInviteInput, staffRole } from './schemas'

const actorOf = (context: { user: { id: string }; role: 'owner' | 'admin' | 'member'; superAdmin: boolean }) => ({
  userId: context.user.id,
  role: context.role,
  superAdmin: context.superAdmin,
})

// Members and invitations of the shop. Owners/admins of the shop, or a super admin (any shop).
export const staff = {
  list: shopManager.route({ method: 'GET', path: '/admin/staff' }).handler(async ({ context }) => {
    const [members, invitations] = await Promise.all([
      staffService.listMembers(context.shop.id),
      staffService.listInvitations(context.shop.id),
    ])
    return { members, invitations }
  }),

  invite: shopManager
    .route({ method: 'POST', path: '/admin/staff/invitations' })
    .input(staffInviteInput)
    .handler(({ input, context }) =>
      staffService.invite(context.shop.id, actorOf(context), input, INVITATION_EXPIRES_IN_DAYS),
    ),

  cancelInvitation: shopManager
    .route({ method: 'POST', path: '/admin/staff/invitations/{id}/cancel' })
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const invitation = await staffService.cancelInvitation(context.shop.id, input.id)
      if (!invitation) throw new ORPCError('NOT_FOUND')
      return invitation
    }),

  updateRole: shopManager
    .route({ method: 'PATCH', path: '/admin/staff/members/{id}' })
    .input(z.object({ id: z.string(), role: staffRole }))
    .handler(({ input, context }) => staffService.updateRole(context.shop.id, actorOf(context), input.id, input.role)),

  remove: shopManager
    .route({ method: 'DELETE', path: '/admin/staff/members/{id}' })
    .input(z.object({ id: z.string() }))
    .handler(({ input, context }) => staffService.removeMember(context.shop.id, actorOf(context), input.id)),
}
