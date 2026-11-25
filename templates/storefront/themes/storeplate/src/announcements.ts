// The announcement bar with two or more messages: arrows move between them, and, when the merchant turns it on, it moves on
// by itself. Rotation can always be stopped: a pause button, and it also holds while the pointer or focus is on the bar,
// and never starts for visitors who asked for less motion or inside the theme editor's preview. Without this script the
// first message shows and the rest stay hidden.
const inEditor = !!document.querySelector('meta[name="shopnex-admin-origin"]')

for (const bar of document.querySelectorAll<HTMLElement>('[data-announcements]')) {
  const slides = [...bar.querySelectorAll<HTMLElement>('[data-announcement-slide]')]
  if (slides.length < 2) continue

  let index = 0
  const show = (next: number) => {
    index = (next + slides.length) % slides.length
    slides.forEach((slide, i) => (slide.hidden = i !== index))
  }
  bar.querySelector('[data-announcement-prev]')?.addEventListener('click', () => show(index - 1))
  bar.querySelector('[data-announcement-next]')?.addEventListener('click', () => show(index + 1))

  const seconds = Math.min(10, Math.max(3, Number(bar.dataset.speed) || 5))
  const toggle = bar.querySelector<HTMLButtonElement>('[data-announcement-toggle]')
  let playing = bar.dataset.auto === 'true' && !inEditor && !matchMedia('(prefers-reduced-motion: reduce)').matches
  let held = false // pointer or focus on the bar
  let timer: ReturnType<typeof setInterval> | undefined

  const sync = () => {
    clearInterval(timer)
    timer = undefined
    if (playing && !held) timer = setInterval(() => show(index + 1), seconds * 1000)
    if (!toggle) return
    toggle.setAttribute('aria-label', (playing ? toggle.dataset.labelPause : toggle.dataset.labelPlay) ?? '')
    // An SVG has no `hidden` property (only HTML elements do): set the attribute itself
    toggle.querySelector('[data-icon-pause]')?.toggleAttribute('hidden', !playing)
    toggle.querySelector('[data-icon-play]')?.toggleAttribute('hidden', playing)
  }

  toggle?.addEventListener('click', () => {
    playing = !playing
    sync()
  })
  for (const [event, value] of [
    ['mouseenter', true],
    ['mouseleave', false],
    ['focusin', true],
    ['focusout', false],
  ] as const) {
    bar.addEventListener(event, () => {
      held = value
      sync()
    })
  }
  sync()
}
