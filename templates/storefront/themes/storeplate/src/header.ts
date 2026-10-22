// The header's side drawer menu (small screens), its submenus, and a shadow once the page scrolls
const header = document.querySelector('header')
const drawer = document.querySelector('[data-menu-drawer]')
const overlay = document.querySelector('[data-menu-overlay]')

function setOpen(open: boolean) {
  drawer?.classList.toggle('-translate-x-full', !open)
  overlay?.classList.toggle('hidden', !open)
}

document.querySelector('[data-menu-open]')?.addEventListener('click', () => setOpen(true))
document.querySelector('[data-menu-close]')?.addEventListener('click', () => setOpen(false))
overlay?.addEventListener('click', () => setOpen(false))
for (const toggle of document.querySelectorAll<HTMLElement>('[data-submenu-toggle]')) {
  toggle.addEventListener('click', () => {
    toggle.nextElementSibling?.classList.toggle('hidden')
    toggle.querySelector('.submenu-arrow')?.classList.toggle('active')
  })
}
window.addEventListener('scroll', () => header?.classList.toggle('shadow-sm', window.scrollY > 0), { passive: true })
