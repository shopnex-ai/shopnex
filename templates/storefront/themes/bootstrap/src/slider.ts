// The card sliders (snippets/featured-slider.liquid): the row scrolls with CSS scroll snapping, and the arrow
// buttons move it by one card. The buttons show only when the row overflows.
for (const slider of document.querySelectorAll<HTMLElement>('[data-slider]')) {
  const track = slider.querySelector<HTMLElement>('[data-slider-track]')!
  const prev = slider.querySelector<HTMLButtonElement>('[data-slider-prev]')!
  const next = slider.querySelector<HTMLButtonElement>('[data-slider-next]')!

  const step = () => (track.firstElementChild as HTMLElement | null)?.offsetWidth ?? track.clientWidth
  const update = () => {
    const overflows = track.scrollWidth > track.clientWidth + 1
    prev.hidden = next.hidden = !overflows
    prev.disabled = track.scrollLeft <= 1
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1
  }

  prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }))
  next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }))
  track.addEventListener('scroll', update, { passive: true })
  new ResizeObserver(update).observe(track)
  update()
}
