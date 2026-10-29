// The catalog's sort select (templates/collection.liquid): each option's value is the page's URL for that sort
document
  .querySelector<HTMLSelectElement>('[data-sort]')
  ?.addEventListener('change', (e) => (location.href = (e.target as HTMLSelectElement).value))
