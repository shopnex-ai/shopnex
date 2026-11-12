'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/** navigator.clipboard only exists on https and localhost; on a LAN address (a dev server on another machine) fall back to a hidden textarea */
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // denied: try the fallback
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/** A shell command in a box: clicking anywhere on it copies it */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${command}`}
      className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl border border-fd-border bg-fd-card px-4 py-3 text-left font-mono text-sm transition-colors hover:border-fd-primary/60"
      onClick={async () => {
        if (await copy(command)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
      }}
    >
      <code className="overflow-x-auto whitespace-nowrap">{command}</code>
      <span className="flex shrink-0 items-center gap-2 text-fd-muted-foreground group-hover:text-fd-foreground">
        {copied && <span className="font-sans text-xs">Copied</span>}
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </span>
    </button>
  )
}
