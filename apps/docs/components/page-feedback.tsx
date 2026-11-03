import { CircleCheck, CircleHelp, MessageSquareWarning } from 'lucide-react'

const REPO = 'https://github.com/shopnex-ai/shopnex'

function issueUrl(path: string, title: string) {
  const params = new URLSearchParams({
    title: `Docs: ${title}`,
    body: `**Page:** /docs/${path}\n\n**What is wrong or missing?**\n\n`,
    labels: 'documentation',
  })
  return `${REPO}/issues/new?${params}`
}

export function PageFeedback(props: { path: string; title: string; verified?: Date; verifiedVersion?: string }) {
  const { path, title, verified, verifiedVersion } = props
  const date = verified?.toISOString().slice(0, 10)

  return (
    <div className="mt-10 flex flex-col gap-2 border-t pt-4 text-sm text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-center gap-2">
        {date ? (
          <>
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            Last verified {date}
            {verifiedVersion ? ` on ${verifiedVersion}` : ''}
          </>
        ) : (
          <>
            <span className="group relative inline-flex" tabIndex={0} aria-describedby="not-verified-tip">
              <CircleHelp className="size-4 shrink-0" aria-hidden />
              <span
                id="not-verified-tip"
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-64 rounded-md border bg-fd-popover p-2 text-xs text-fd-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus:opacity-100"
              >
                No one has run this page's steps end to end yet, so some may need adjusting. If something breaks, please
                report it.
              </span>
            </span>
            Not verified
          </>
        )}
      </p>
      <a
        href={issueUrl(path, title)}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 underline underline-offset-4 hover:text-fd-foreground"
      >
        <MessageSquareWarning className="size-4 shrink-0" aria-hidden />
        Found an issue?
      </a>
    </div>
  )
}
