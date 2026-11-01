'use client'

// Hosts an app in an iframe and answers its @shopnex/app-bridge messages (protocol: packages/app-bridge).
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { AdminMessage, AppMessage } from '@shopnex/app-bridge'
import { client } from '@/lib/orpc'
import { AppIcon, UninstallButton } from '../installed-apps-card'

type Props = { installationId: string; src: string; name: string; iconUrl: string | null }
// AdminMessage without the envelope (Omit on the union would collapse it)
type Reply = { type: 'session-token'; token: string } | { type: 'error'; message: string } | { type: 'ok' }

export function EmbeddedApp({ installationId, src, name, iconUrl }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const appOrigin = new URL(src).origin
  const navigate = useNavigate()

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      // Only our iframe, and only while it's on the app's origin
      if (event.source !== frame.current?.contentWindow || event.origin !== appOrigin) return
      const message = event.data as AppMessage
      if (message?.source !== 'shopnex-app' || message.v !== 1 || typeof message.id !== 'string') return

      const reply = (body: Reply) => {
        const out: AdminMessage = { ...body, source: 'shopnex-admin', v: 1, id: message.id }
        frame.current?.contentWindow?.postMessage(out, appOrigin)
      }

      try {
        switch (message.type) {
          case 'session-token': {
            const { token } = await client.admin.apps.sessionToken({ id: installationId })
            reply({ type: 'session-token', token })
            break
          }
          case 'toast':
            if (message.isError) toast.error(String(message.message).slice(0, 300))
            else toast.success(String(message.message).slice(0, 300))
            reply({ type: 'ok' })
            break
          case 'redirect': {
            // Leave the iframe only for this admin or the app's own site (e.g. its install/OAuth start)
            const target = new URL(message.url)
            if (target.origin !== window.location.origin && target.origin !== appOrigin) {
              throw new Error(`Redirect to ${target.origin} isn't allowed`)
            }
            reply({ type: 'ok' })
            window.location.assign(target.toString())
            break
          }
          default:
            throw new Error('Unknown message')
        }
      } catch (error) {
        reply({ type: 'error', message: error instanceof Error ? error.message : 'Failed' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appOrigin, installationId])

  return (
    // Full-bleed: cancel the layout's padding, fill the height below the header (h-12)
    <div className="-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm">
        <Link to="/admin/apps" className="text-muted-foreground hover:text-foreground">
          Apps
        </Link>
        <span className="text-muted-foreground">/</span>
        <AppIcon url={iconUrl} className="size-5 rounded" />
        <span className="font-medium">{name}</span>
        <div className="ml-auto">
          <UninstallButton
            installation={{ id: installationId, app: { name } }}
            onUninstalled={() => void navigate({ to: '/admin/apps' })}
          />
        </div>
      </div>
      <iframe
        ref={frame}
        src={src}
        title={name}
        className="w-full flex-1 border-0 bg-background"
        // Its own origin, so allow-same-origin lets it keep its storage without reaching the admin's
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-write"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
