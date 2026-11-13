// Small pieces of UI: the sticky header that hides while scrolling down, and the catalog's sort select.

// ── sticky header (snippets/header.liquid): hides on the way down, returns on the way up ──
const header = document.querySelector<HTMLElement>('[data-header][data-sticky]')
if (header) {
  let last = window.scrollY
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY
      const hidden = y > last && y > header.offsetHeight && !header.querySelector('details[open]')
      header.classList.toggle('-translate-y-full', hidden)
      last = y
    },
    { passive: true },
  )
}

// ── sort (templates/collection.liquid) ──
document.querySelector<HTMLSelectElement>('[data-sort]')?.addEventListener('change', (e) => {
  // The options are links on this shop: never follow one that leaves it (or a javascript: URL)
  const url = new URL((e.target as HTMLSelectElement).value, location.href)
  if (url.origin === location.origin) location.href = url.href
})
