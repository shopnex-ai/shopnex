// Hosts an app in an iframe and answers its @shopnex/app-bridge messages (protocol: packages/app-bridge).
import { useNavigate } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AdminMessage, AppMessage } from '@shopnex/app-bridge'
import { PageHeader } from '@/components/admin/page-header'
import { Workspace } from '@/components/admin/workspace'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { client } from '@/lib/orpc'
import { PreviewLoader } from '@/screens/online-store/themes/preview-loader'
import { AppIcon, UninstallButton } from '../installed-apps-card'

// A question from the app, waiting for the person's answer
type Question = { title: string; message?: string; label: string; answer: (confirmed: boolean) => void }

type Props = { installationId: string; src: string; name: string; iconUrl: string | null }
// AdminMessage without the envelope (Omit on the union would collapse it)
type Reply =
  | { type: 'session-token'; token: string }
  | { type: 'theme'; theme: 'light' | 'dark' }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'error'; message: string }
  | { type: 'ok' }

export function EmbeddedApp({ installationId, src, name, iconUrl }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  // The ShopNex loader shows over the app until its page has loaded
  const [loaded, setLoaded] = useState(false)
  // The iframe is only mounted in the browser: on a reload the server-rendered one can finish loading before React
  // attaches onLoad, and the loader would never go away
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const appOrigin = new URL(src).origin
  const navigate = useNavigate()
  const [question, setQuestion] = useState<Question | null>(null)
  // The theme the admin shows, which the app follows (instead of the OS setting)
  const { resolvedTheme } = useTheme()
  const theme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light'
  const themeRef = useRef(theme)
  themeRef.current = theme

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
          case 'theme':
            reply({ type: 'theme', theme: themeRef.current })
            break
          case 'toast':
            if (message.isError) toast.error(String(message.message).slice(0, 300))
            else toast.success(String(message.message).slice(0, 300))
            reply({ type: 'ok' })
            break
          case 'confirm': {
            // One question at a time: a new one answers the old one with no
            const confirmed = await new Promise<boolean>((answer) =>
              setQuestion((current) => {
                current?.answer(false)
                return {
                  title: String(message.title).slice(0, 200),
                  message: message.message === undefined ? undefined : String(message.message).slice(0, 500),
                  label: message.label === undefined ? 'Confirm' : String(message.label).slice(0, 40),
                  answer,
                }
              }),
            )
            reply({ type: 'confirm', confirmed })
            break
          }
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

  // Tell the app when the theme changes (it asks once when it loads)
  useEffect(() => {
    const message: AdminMessage = { source: 'shopnex-admin', v: 1, id: '', type: 'theme', theme }
    frame.current?.contentWindow?.postMessage(message, appOrigin)
  }, [theme, appOrigin])

  const answer = (confirmed: boolean) => {
    question?.answer(confirmed)
    setQuestion(null)
  }

  return (
    <Workspace>
      <PageHeader
        back={{ to: '/admin/apps', label: 'Apps' }}
        title={
          <span className="inline-flex items-center gap-2">
            <AppIcon url={iconUrl} className="size-5 rounded" />
            {name}
          </span>
        }
        actions={
          <UninstallButton
            installation={{ id: installationId, app: { name } }}
            onUninstalled={() => void navigate({ to: '/admin/apps' })}
          />
        }
      />
      <div className="relative flex-1">
        {mounted && (
          <>
            <iframe
              ref={frame}
              src={src}
              title={name}
              className="h-full w-full border-0 bg-background"
              onLoad={() => setLoaded(true)}
              // Its own origin, so allow-same-origin lets it keep its storage without reaching the admin's
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              allow="clipboard-write"
              referrerPolicy="no-referrer"
            />
            <Dialog open={question !== null} onOpenChange={(open) => !open && answer(false)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{question?.title}</DialogTitle>
                  {question?.message && <DialogDescription>{question.message}</DialogDescription>}
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => answer(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => answer(true)}>
                    {question?.label}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
        {!loaded && <PreviewLoader />}
      </div>
    </Workspace>
  )
}
