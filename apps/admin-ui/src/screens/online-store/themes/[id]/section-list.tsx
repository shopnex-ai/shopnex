// A page's sections, or a section's blocks: drag to reorder, eye to hide, click to edit, "Add …" for the types on offer.
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EyeIcon, EyeOffIcon, GripVerticalIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThemeDefinition, ThemeSection, ThemeSettings } from '@shopnex/storefront-sdk/theme'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Sections only move up and down
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/** What both lists hold: a section or a block */
type Item = { id: string; type: string; disabled?: boolean; settings: ThemeSettings }

type ListProps<T extends Item> = {
  items: T[]
  /** Display name by type; a type missing here is one the theme no longer has */
  names: Record<string, string | undefined>
  /** What a row is called in labels: "section" or "block" */
  noun: 'section' | 'block'
  /** The types the "Add" menu offers; `full`: no more of it fits */
  addable: { type: string; name: string; full: boolean }[]
  /** Everything is full, whatever the type (a section's max_blocks) */
  disableAdd?: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (items: T[]) => void
  onAdd: (type: string) => void
}

type Props = {
  definition: ThemeDefinition
  sections: ThemeSection[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (sections: ThemeSection[]) => void
  onAdd: (type: string) => void
}

export function SectionList({ definition, sections, selectedId, onSelect, onChange, onAdd }: Props) {
  return (
    <ItemList
      items={sections}
      names={Object.fromEntries(Object.entries(definition.sections).map(([type, def]) => [type, def.name]))}
      noun="section"
      addable={Object.entries(definition.sections).map(([type, def]) => ({
        type,
        name: def.name,
        full: def.limit != null && sections.filter((s) => s.type === type).length >= def.limit,
      }))}
      selectedId={selectedId}
      onSelect={onSelect}
      onChange={onChange}
      onAdd={onAdd}
    />
  )
}

export function ItemList<T extends Item>({
  items,
  names,
  noun,
  addable,
  disableAdd,
  selectedId,
  onSelect,
  onChange,
  onAdd,
}: ListProps<T>) {
  const sensors = useSensors(
    // A small distance, so a click on the row still selects it
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // The row being dragged is drawn in an overlay on <body>: inside the panel (a scroll container) it
  // would be clipped at the panel's edge
  const [dragging, setDragging] = useState<T | null>(null)
  // Stable across server and client render (dnd-kit's own counter differs and breaks hydration)
  const dndId = useId()

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    if (!over || active.id === over.id) return
    const from = items.findIndex((s) => s.id === active.id)
    const to = items.findIndex((s) => s.id === over.id)
    onChange(arrayMove(items, from, to))
  }

  return (
    <div className="space-y-2">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragStart={({ active }) => setDragging(items.find((s) => s.id === active.id) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                name={names[item.type]}
                noun={noun}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item.id)}
                onToggle={() => onChange(items.map((s) => (s.id === item.id ? { ...s, disabled: !s.disabled } : s)))}
              />
            ))}
          </ul>
        </SortableContext>
        {typeof document !== 'undefined' &&
          createPortal(
            <DragOverlay>
              {dragging && <RowContent item={dragging} name={names[dragging.type]} noun={noun} className="shadow-lg" />}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
      {items.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No {noun}s yet.</p>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-full" disabled={disableAdd} />}>
          <PlusIcon />
          Add {noun}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {addable.map((a) => (
            <DropdownMenuItem key={a.type} disabled={a.full} onClick={() => onAdd(a.type)}>
              {a.name}
              {a.full && <span className="ml-auto text-xs text-muted-foreground">Added</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ItemRow<T extends Item>({
  item,
  name,
  noun,
  selected,
  onSelect,
  onToggle,
}: {
  item: T
  /** Undefined: the theme no longer has this type */
  name: string | undefined
  noun: 'section' | 'block'
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <RowContent
        item={item}
        name={name}
        noun={noun}
        // The overlay shows the moving copy; this one marks where it will land
        className={cn(selected && 'border-primary ring-1 ring-primary', isDragging && 'opacity-40')}
        handle={{ ref: setActivatorNodeRef, ...attributes, ...listeners }}
        onSelect={onSelect}
        onToggle={onToggle}
      />
    </li>
  )
}

/** The first text setting that says what a row holds: a heading, or a block's text */
const previewOf = (settings: ThemeSettings) => {
  for (const key of ['heading', 'title', 'text', 'label']) {
    const value = settings[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function RowContent({
  item,
  name,
  noun,
  className,
  handle,
  onSelect,
  onToggle,
}: {
  item: Item
  name: string | undefined
  noun: 'section' | 'block'
  className?: string
  handle?: React.ComponentProps<'button'>
  onSelect?: () => void
  onToggle?: () => void
}) {
  const heading = previewOf(item.settings)
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border bg-background pr-1 text-sm',
        item.disabled && 'text-muted-foreground',
        className,
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none p-2 text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...handle}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 py-2 text-left">
        <span className={cn('block truncate font-medium', item.disabled && 'line-through')}>
          {name ?? `Unknown ${noun} (${item.type})`}
        </span>
        {heading && <span className="block truncate text-xs text-muted-foreground">{heading}</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggle}
        aria-label={item.disabled ? `Show ${noun}` : `Hide ${noun}`}
        title={item.disabled ? 'Hidden: click to show' : 'Hide'}
      >
        {item.disabled ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}
