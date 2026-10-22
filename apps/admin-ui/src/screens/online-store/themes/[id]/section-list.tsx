'use client'

// A page's sections: drag to reorder, eye to hide, click to edit, "Add section" for the theme's types.
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
import type { ThemeDefinition, ThemeSection } from '@shopnex/storefront-sdk/theme'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Sections only move up and down
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

type Props = {
  definition: ThemeDefinition
  sections: ThemeSection[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (sections: ThemeSection[]) => void
  onAdd: (type: string) => void
}

export function SectionList({ definition, sections, selectedId, onSelect, onChange, onAdd }: Props) {
  const sensors = useSensors(
    // A small distance, so a click on the row still selects it
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // The row being dragged is drawn in an overlay on <body>: inside the panel (a scroll container) it
  // would be clipped at the panel's edge
  const [dragging, setDragging] = useState<ThemeSection | null>(null)
  // Stable across server and client render (dnd-kit's own counter differs and breaks hydration)
  const dndId = useId()

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    if (!over || active.id === over.id) return
    const from = sections.findIndex((s) => s.id === active.id)
    const to = sections.findIndex((s) => s.id === over.id)
    onChange(arrayMove(sections, from, to))
  }

  const addable = Object.entries(definition.sections).map(([type, def]) => ({
    type,
    name: def.name,
    full: def.limit != null && sections.filter((s) => s.type === type).length >= def.limit,
  }))

  return (
    <div className="space-y-2">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragStart={({ active }) => setDragging(sections.find((s) => s.id === active.id) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {sections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                name={definition.sections[section.type]?.name}
                selected={section.id === selectedId}
                onSelect={() => onSelect(section.id)}
                onToggle={() =>
                  onChange(sections.map((s) => (s.id === section.id ? { ...s, disabled: !s.disabled } : s)))
                }
              />
            ))}
          </ul>
        </SortableContext>
        {typeof document !== 'undefined' &&
          createPortal(
            <DragOverlay>
              {dragging && (
                <RowContent section={dragging} name={definition.sections[dragging.type]?.name} className="shadow-lg" />
              )}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
      {sections.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No sections yet.</p>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-full" />}>
          <PlusIcon />
          Add section
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

function SectionRow({
  section,
  name,
  selected,
  onSelect,
  onToggle,
}: {
  section: ThemeSection
  /** Undefined: the theme no longer has this section type */
  name: string | undefined
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <RowContent
        section={section}
        name={name}
        // The overlay shows the moving copy; this one marks where it will land
        className={cn(selected && 'border-primary ring-1 ring-primary', isDragging && 'opacity-40')}
        handle={{ ref: setActivatorNodeRef, ...attributes, ...listeners }}
        onSelect={onSelect}
        onToggle={onToggle}
      />
    </li>
  )
}

function RowContent({
  section,
  name,
  className,
  handle,
  onSelect,
  onToggle,
}: {
  section: ThemeSection
  name: string | undefined
  className?: string
  handle?: React.ComponentProps<'button'>
  onSelect?: () => void
  onToggle?: () => void
}) {
  const heading = typeof section.settings.heading === 'string' ? section.settings.heading.trim() : ''
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border bg-background pr-1 text-sm',
        section.disabled && 'text-muted-foreground',
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
        <span className={cn('block truncate font-medium', section.disabled && 'line-through')}>
          {name ?? `Unknown section (${section.type})`}
        </span>
        {heading && <span className="block truncate text-xs text-muted-foreground">{heading}</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggle}
        aria-label={section.disabled ? 'Show section' : 'Hide section'}
        title={section.disabled ? 'Hidden: click to show' : 'Hide'}
      >
        {section.disabled ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}
