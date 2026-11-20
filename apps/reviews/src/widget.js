// The storefront widget. Put this where reviews should show (a Custom HTML section on the product page):
//   <div data-shopnex-reviews data-instance="https://shop.example.com" data-shop="…" data-product="{{ product.id }}"></div>
//   <script src="https://reviews.example.com/widget.js" async></script>
// Optional: data-name="{{ product.title }}" names the product in the search-engine rating markup.
// Everything from the server is written with textContent, never as HTML. The widget takes the page's font and text
// colour, so it fits light and dark themes.
;(function () {
  var origin = new URL(document.currentScript ? document.currentScript.src : location.href).origin
  var PAGE = 10
  var GOLD = '#e8a317'

  function el(tag, style, text) {
    var node = document.createElement(tag)
    if (style) node.style.cssText = style
    if (text !== undefined) node.textContent = text
    return node
  }

  // Five stars, the first `rating` of them gold (half stars are rounded to the nearest whole star)
  function stars(rating, size) {
    var row = el('span', 'letter-spacing:.08em;white-space:nowrap;font-size:' + size)
    row.setAttribute('role', 'img')
    row.setAttribute('aria-label', rating + ' out of 5 stars')
    var full = Math.round(rating)
    row.appendChild(el('span', 'color:' + GOLD, '★★★★★'.slice(0, full)))
    row.appendChild(el('span', 'opacity:.25', '★★★★★'.slice(0, 5 - full)))
    return row
  }

  function summary(data) {
    var box = el('div', 'display:flex;flex-wrap:wrap;gap:1.5rem 2.5rem;align-items:center;padding-bottom:1.25rem')
    var left = el('div', 'min-width:8rem')
    left.appendChild(el('div', 'font-size:2.75rem;font-weight:700;line-height:1', data.average.toFixed(1)))
    left.appendChild(stars(data.average, '1.1rem'))
    left.appendChild(
      el(
        'div',
        'opacity:.7;font-size:.9em;margin-top:.25rem',
        data.count + (data.count === 1 ? ' review' : ' reviews'),
      ),
    )
    box.appendChild(left)

    var bars = el('div', 'flex:1;min-width:12rem;max-width:22rem')
    for (var star = 5; star >= 1; star--) {
      var n = data.distribution[star] || 0
      var row = el('div', 'display:flex;align-items:center;gap:.6rem;font-size:.85em;margin:.2rem 0')
      row.appendChild(el('span', 'width:.9rem;text-align:right', String(star)))
      var track = el('div', 'flex:1;height:.5rem;border-radius:999px;background:rgba(128,128,128,.25);overflow:hidden')
      var fill = el('div', 'height:100%;border-radius:999px;background:' + GOLD)
      fill.style.width = (data.count ? (n / data.count) * 100 : 0) + '%'
      track.appendChild(fill)
      row.appendChild(track)
      row.appendChild(el('span', 'width:2rem;opacity:.7', String(n)))
      bars.appendChild(row)
    }
    box.appendChild(bars)
    return box
  }

  function card(review) {
    var item = el('article', 'border-top:1px solid rgba(128,128,128,.3);padding:1rem 0')
    var top = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .75rem')
    top.appendChild(stars(review.rating, '1rem'))
    if (review.title) top.appendChild(el('strong', '', review.title))
    item.appendChild(top)
    item.appendChild(el('p', 'margin:.5rem 0;white-space:pre-line', review.body))
    var meta = el('p', 'margin:0;opacity:.7;font-size:.85em')
    meta.textContent =
      review.author +
      (review.verified ? ' · Verified buyer' : '') +
      ' · ' +
      new Date(review.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    item.appendChild(meta)
    if (review.reply) {
      var reply = el(
        'div',
        'margin:.75rem 0 0 1rem;padding:.25rem 0 .25rem .75rem;border-left:3px solid rgba(128,128,128,.4)',
      )
      reply.appendChild(el('p', 'margin:0;font-size:.85em;font-weight:600;opacity:.8', 'Reply from the shop'))
      reply.appendChild(el('p', 'margin:.15rem 0 0;white-space:pre-line', review.reply))
      item.appendChild(reply)
    }
    return item
  }

  // Tells search engines the product's rating (the reviews themselves are on the page)
  function markup(root, data) {
    var name = root.getAttribute('data-name') || document.title
    var script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: name,
      aggregateRating: { '@type': 'AggregateRating', ratingValue: data.average, reviewCount: data.count },
    })
    root.appendChild(script)
  }

  function render(root, data, query) {
    root.textContent = ''
    var box = el('div', 'font-family:inherit;color:inherit;max-width:44rem')
    box.className = 'snx-reviews'
    if (!data.count) {
      box.appendChild(el('p', 'opacity:.7', 'No reviews yet.'))
      root.appendChild(box)
      return
    }
    box.appendChild(summary(data))
    var list = el('div')
    box.appendChild(list)
    var shown = 0
    function add(reviews) {
      reviews.forEach(function (review) {
        list.appendChild(card(review))
      })
      shown += reviews.length
    }
    add(data.reviews)

    var more = el(
      'button',
      'margin-top:.5rem;padding:.55rem 1.1rem;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:999px;cursor:pointer',
      'Load more reviews',
    )
    more.type = 'button'
    more.onclick = function () {
      more.disabled = true
      load(query, shown).then(function (next) {
        if (next) add(next.reviews)
        more.disabled = false
        if (!next || shown >= data.count) more.remove()
      })
    }
    if (shown < data.count) box.appendChild(more)
    root.appendChild(box)
    markup(root, data)
  }

  function load(query, offset) {
    var params = new URLSearchParams(query)
    params.set('limit', String(PAGE))
    params.set('offset', String(offset))
    return fetch(origin + '/public/reviews?' + params)
      .then(function (res) {
        return res.ok ? res.json() : null
      })
      .catch(function () {
        return null
      })
  }

  document.querySelectorAll('[data-shopnex-reviews]').forEach(function (root) {
    var query = {
      instance: root.getAttribute('data-instance') || '',
      shop: root.getAttribute('data-shop') || '',
      product: root.getAttribute('data-product') || '',
    }
    load(query, 0).then(function (data) {
      if (data) render(root, data, query)
    })
  })
})()
