import type { ThemeDefinition } from '@shopnex/storefront-sdk/theme'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { previewPageOptions, type PreviewCatalog } from './preview-pages'

type Props = {
  definition: ThemeDefinition | null
  catalog: PreviewCatalog
  value: string
  onChange: (value: string) => void
  className?: string
}

export function PreviewPageSelect({ definition, catalog, value, onChange, className }: Props) {
  const options = previewPageOptions(definition, catalog)
  return (
    <Select items={options} value={value} onValueChange={(next) => next != null && onChange(String(next))}>
      <SelectTrigger className={className} aria-label="Preview page">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
