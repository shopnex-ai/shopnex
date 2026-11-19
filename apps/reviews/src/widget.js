// The storefront widget. Put this where reviews should show (a Custom HTML section on the product page):
//   <div data-shopnex-reviews data-instance="https://shop.example.com" data-shop="…" data-product="{{ product.id }}"></div>
//   <script src="https://reviews.example.com/widget.js" async></script>
// Everything from the server is written with textContent, never as HTML.
;(function () {
  var origin = new URL(document.currentScript ? document.currentScript.src : location.href).origin

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function stars(rating) {
    var full = Math.round(rating)
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full)
  }

  function render(root, data) {
    root.textContent = ''
    var box = el('div', 'snx-reviews')
    box.style.cssText = 'font-family:inherit;max-width:42rem'
    if (!data.count) {
      box.appendChild(el('p', 'snx-reviews-empty', 'No reviews yet.'))
    } else {
      var head = el('p', 'snx-reviews-summary')
      head.style.fontWeight = '600'
      head.textContent =
        stars(data.average) + '  ' + data.average + ' · ' + data.count + (data.count === 1 ? ' review' : ' reviews')
      box.appendChild(head)
      data.reviews.forEach(function (review) {
        var item = el('article', 'snx-review')
        item.style.cssText = 'border-top:1px solid #8884;padding:.75rem 0'
        var line = el('p', 'snx-review-rating', stars(review.rating) + (review.title ? '  ' + review.title : ''))
        line.style.fontWeight = '600'
        item.appendChild(line)
        item.appendChild(el('p', 'snx-review-body', review.body))
        var by = review.author + (review.verified ? ' · Verified buyer' : '')
        var meta = el('p', 'snx-review-author', by)
        meta.style.cssText = 'opacity:.7;font-size:.85em'
        item.appendChild(meta)
        box.appendChild(item)
      })
    }
    root.appendChild(box)
  }

  document.querySelectorAll('[data-shopnex-reviews]').forEach(function (root) {
    var query = new URLSearchParams({
      instance: root.getAttribute('data-instance') || '',
      shop: root.getAttribute('data-shop') || '',
      product: root.getAttribute('data-product') || '',
    })
    fetch(origin + '/public/reviews?' + query)
      .then(function (res) {
        return res.ok ? res.json() : null
      })
      .then(function (data) {
        if (data) render(root, data)
      })
      .catch(function () {})
  })
})()
