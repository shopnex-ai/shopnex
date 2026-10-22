// Small pieces of UI: the closable announcement bar, testimonial arrows, the catalog's sort select and the
// product page's tabs.

// ── announcement bar (snippets/header.liquid): closed stays closed until its text changes ──
const ANNOUNCEMENT_KEY = 'shopco-announcement-closed'
const announcement = document.querySelector<HTMLElement>('[data-announcement]')
if (announcement) {
  const id = announcement.dataset.announcement!
  try {
    if (localStorage.getItem(ANNOUNCEMENT_KEY) === id) announcement.remove()
  } catch {
    // no storage
  }
  announcement.querySelector('[data-announcement-close]')?.addEventListener('click', () => {
    announcement.remove()
    try {
      localStorage.setItem(ANNOUNCEMENT_KEY, id)
    } catch {
      // no storage
    }
  })
}

// ── carousels (sections/testimonials.liquid): arrows scroll by one card ──
for (const carousel of document.querySelectorAll<HTMLElement>('[data-carousel]')) {
  const track = carousel.querySelector<HTMLElement>('[data-carousel-track]')!
  const step = (direction: number) => {
    const card = track.firstElementChild as HTMLElement | null
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0
    track.scrollBy({ left: direction * ((card?.offsetWidth ?? track.clientWidth) + gap), behavior: 'smooth' })
  }
  carousel.querySelector('[data-carousel-prev]')?.addEventListener('click', () => step(-1))
  carousel.querySelector('[data-carousel-next]')?.addEventListener('click', () => step(1))
}

// ── sort (templates/collection.liquid) ──
document
  .querySelector<HTMLSelectElement>('[data-sort]')
  ?.addEventListener('change', (e) => (location.href = (e.target as HTMLSelectElement).value))

// ── tabs (templates/product.liquid) ──
for (const tabs of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
  tabs.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')
    if (!tab) return
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)))
    tabs
      .querySelectorAll<HTMLElement>('[data-panel]')
      .forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab))
  })
}
