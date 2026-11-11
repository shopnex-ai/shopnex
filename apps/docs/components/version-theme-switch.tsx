'use client'

import { ThemeSwitch, type ThemeSwitchProps } from 'fumadocs-ui/layouts/shared/slots/theme-switch'
import { version } from '../package.json'

// The sidebar's footer bar is [GitHub icon … theme switch]: put the release these docs describe right after the GitHub icon.
// `pnpm bump` keeps package.json in step with the git tag.
export function VersionThemeSwitch({ className, ...props }: ThemeSwitchProps) {
  return (
    <>
      <a
        href={`https://github.com/shopnex-ai/shopnex/releases/tag/v${version}`}
        target="_blank"
        rel="noreferrer"
        className="ms-2 text-xs text-fd-muted-foreground hover:text-fd-foreground"
      >
        v{version}
      </a>
      <ThemeSwitch {...props} className={className} />
    </>
  )
}
