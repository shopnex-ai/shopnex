// The archive's Grid / List buttons and sort select (snippets/archive.liquid)
for (const archive of document.querySelectorAll<HTMLElement>('[data-archive]')) {
  archive.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view-btn]')
    if (!b) return
    archive.querySelector<HTMLElement>('[data-pieces]')?.setAttribute('data-view', b.dataset.viewBtn!)
    archive.querySelectorAll<HTMLElement>('[data-view-btn]').forEach((x) => x.classList.toggle('on', x === b))
  })
  archive
    .querySelector<HTMLSelectElement>('[data-sort]')
    ?.addEventListener('change', (e) => (location.href = (e.target as HTMLSelectElement).value))
}
