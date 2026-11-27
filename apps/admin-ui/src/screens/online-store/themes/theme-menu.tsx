// The "…" menu of a theme copy (Online store: the current theme's card and the list under it)
import { ClipboardCopyIcon, CodeIcon, CopyIcon, EllipsisIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { client } from '@/lib/orpc'
import type { Theme } from './theme-dialogs'

// The copy's draft as JSON: what a theme style on the marketplace is made of
export async function copySettings(theme: Theme) {
  try {
    const { draft } = await client.admin.themes.get({ id: theme.id })
    await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
    toast.success(`Copied ${theme.name}’s settings`, {
      description: `To sell it as a style for ${theme.themeId} on the marketplace, paste them in a new theme style.`,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Couldn’t copy the settings')
  }
}

type MenuProps = {
  theme: Theme
  onRename: () => void
  onDuplicate?: () => void
  onCopySettings?: () => void
  onDelete: () => void
}

// A live copy can't be deleted: its storefront shows it
export function ThemeMenu({ theme, onRename, onDuplicate, onCopySettings, onDelete }: MenuProps) {
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ to: '/admin/online-store/editor/$id/code', params: { id: theme.id } })}
        >
          <CodeIcon />
          Edit code
        </DropdownMenuItem>
        {onDuplicate && (
          <DropdownMenuItem onClick={onDuplicate}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
        )}
        {onCopySettings && (
          <DropdownMenuItem onClick={onCopySettings}>
            <ClipboardCopyIcon />
            Copy settings
          </DropdownMenuItem>
        )}
        {theme.role !== 'live' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
