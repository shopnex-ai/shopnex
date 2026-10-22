// The home page's carousels (sections/hero_slider.liquid, sections/collections.liquid)
import Swiper from 'swiper'
import { Navigation, Pagination } from 'swiper/modules'

for (const el of document.querySelectorAll<HTMLElement>('[data-hero-slider]')) {
  new Swiper(el, {
    modules: [Pagination],
    pagination: {
      el: el.querySelector<HTMLElement>('.swiper-pagination'),
      clickable: true,
      bulletClass: 'banner-pagination-bullet',
      bulletActiveClass: 'banner-pagination-bullet-active',
    },
  })
}

for (const el of document.querySelectorAll<HTMLElement>('[data-collections-slider]')) {
  const container = el.parentElement!
  new Swiper(el, {
    modules: [Navigation],
    slidesPerView: 2,
    spaceBetween: 10,
    breakpoints: { 640: { slidesPerView: 2, spaceBetween: 20 }, 768: { slidesPerView: 3, spaceBetween: 24 } },
    navigation: {
      prevEl: container.querySelector<HTMLElement>('[data-slider-prev]'),
      nextEl: container.querySelector<HTMLElement>('[data-slider-next]'),
    },
  })
}
