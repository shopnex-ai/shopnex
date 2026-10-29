// The catalog's sort select (templates/collection.liquid): each option's value is the page's URL for that sort.
// Only same-origin URLs are followed, and only their path and query.
document.querySelector<HTMLSelectElement>('[data-sort]')?.addEventListener('change', (e) => {
  const target = new URL((e.target as HTMLSelectElement).value, location.href)
  if (target.origin === location.origin) location.assign(target.pathname + target.search)
})
