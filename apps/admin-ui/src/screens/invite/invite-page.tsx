import { Link, useLoaderData } from '@tanstack/react-router'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AcceptInvitation, InviteSignUpForm } from './invite-forms'

export function InvitePage() {
  const { invitation, session, existingUser, providers } = useLoaderData({ from: '/admin/invite/$id' })
  if (!invitation)
    return (
      <Shell
        title="Invitation not valid"
        description="It may have expired, been cancelled, or already been used. Ask the shop owner for a new link."
      />
    )
  const { id, email, role, shopName } = invitation
  const title = `Join ${shopName}`
  const description = `You're invited as ${roleLabel[role ?? 'member'] ?? role} (${email}).`
  const path = `/admin/invite/${id}`
  if (session) {
    const sameEmail = session.user.email.toLowerCase() === email.toLowerCase()
    return (
      <Shell title={title} description={description}>
        {sameEmail ? (
          <AcceptInvitation invitationId={id} />
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              You&apos;re signed in as {session.user.email}. Sign out, then open this link again to accept as {email}.
            </p>
            <SignOutButton />
          </div>
        )}
      </Shell>
    )
  }
  if (existingUser)
    return (
      <Shell title={title} description={description}>
        <Button className="w-full" render={<Link to="/admin/login" search={{ next: path }} />}>
          Sign in as {email} to accept
        </Button>
      </Shell>
    )
  return (
    <Shell title={title} description={`${description} Create your account to accept.`}>
      <InviteSignUpForm invitationId={id} email={email} providers={providers} callbackURL={path} />
    </Shell>
  )
}

const roleLabel: Record<string, string> = { owner: 'an owner', admin: 'an admin', member: 'staff' }
function Shell({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center p-6 md:p-10">
      <ShopnexBrand />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  )
}
