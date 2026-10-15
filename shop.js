/* ============================================
   ZALIELS — shop.js
   Catalogue (search · filter · sort · pagination) · Quick View · Cart
   Reads data from products.js. Public API: Zaliels.setProducts(list)
   ============================================ */

(function () {
  'use strict';

  const Z = window.Zaliels = window.Zaliels || {};
  const CFG = window.ZALIELS_CONFIG || {};
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE   = (CFG.pageSize | 0) || 6;
  const MAX_QTY     = 99;
  const STORAGE_KEY = CFG.storageKey || 'zaliels_cart_v1';
  const BRAND       = CFG.brand || 'Zaliels';
  const SYMBOL      = CFG.currencySymbol || '₦';
  const FOCUSABLE   = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  const toast = (msg) => { if (Z.showToast) Z.showToast(msg); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const money = (n) => SYMBOL + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });
  // Responsive srcset for Unsplash URLs (same photo, different widths). Other URLs pass through.
  function imgAttrs(url, widths, sizes) {
    const m = /^(https:\/\/images\.unsplash\.com\/[^?]+)\?(.*)$/.exec(url);
    if (!m) return `src="${esc(url)}"`;
    const srcset = widths.map((w) => {
      const q = new URLSearchParams(m[2]); q.set('w', w);
      return `${m[1]}?${q} ${w}w`;
    }).join(', ');
    return `src="${esc(url)}" srcset="${esc(srcset)}" sizes="${esc(sizes)}"`;
  }
  const lineTotal = (p, q) => Math.round(p.price * 100) * q / 100;

  let products = [];
  let byId = new Map();
  let cart = [];

  /* ============ PRODUCT DATA ============ */

  const list = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '').map(String) : []);

  function normalise(p) {
    return {
      id: String(p.id),
      name: String(p.name),
      price: Number(p.price),
      compareAt: Number(p.compareAt) > Number(p.price) ? Number(p.compareAt) : 0,
      images: list(Array.isArray(p.images) ? p.images : (p.image ? [p.image] : [])),
      description: p.description ? String(p.description) : '',
      category: p.category ? String(p.category) : '',
      sizes: list(p.sizes),
      colours: list(p.colours),
      stock: p.stock == null ? null : p.stock
    };
  }

  const hasOptions = (p) => p.sizes.length > 0 || p.colours.length > 0;

  // Returns a number when stock for this selection is known, otherwise null (unknown).
  function stockFor(p, size, colour) {
    const s = p.stock;
    if (s == null) return null;
    if (typeof s === 'number') return Math.max(0, s);
    if (typeof s === 'object') {
      const keys = [];
      if (size && colour) keys.push(size + '|' + colour);
      if (size) keys.push(size);
      if (colour) keys.push(colour);
      for (const k of keys) {
        if (typeof s[k] === 'number') return Math.max(0, s[k]);
      }
    }
    return null;
  }

  function isSoldOut(p) {
    const s = p.stock;
    if (typeof s === 'number') return s <= 0;
    if (s && typeof s === 'object') {
      const v = Object.values(s).filter((x) => typeof x === 'number');
      return v.length > 0 && v.every((x) => x <= 0);
    }
    return false;
  }

  const maxFor = (p, size, colour) => {
    const s = stockFor(p, size, colour);
    return s == null ? MAX_QTY : Math.min(s, MAX_QTY);
  };

  const variantText = (size, colour) =>
    [size && `Size: ${size}`, colour && `Colour: ${colour}`].filter(Boolean).join(', ');

  /* ============ LAYERS (quick view + cart): focus, Esc, scroll lock ============ */

  let activeLayer = null;
  let lastFocus = null;

  function openLayer(el) {
    if (activeLayer === el) return;
    if (activeLayer) closeLayer(activeLayer, false);
    else lastFocus = document.activeElement;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    if (Z.lockScroll) Z.lockScroll();
    activeLayer = el;
    const first = el.querySelector(FOCUSABLE);
    if (first) first.focus({ preventScroll: true });
  }

  function closeLayer(el, restore) {
    if (activeLayer !== el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (Z.unlockScroll) Z.unlockScroll();
    activeLayer = null;
    if (restore !== false && lastFocus && document.contains(lastFocus)) {
      lastFocus.focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!activeLayer) return;
    if (e.key === 'Escape') { closeLayer(activeLayer); return; }
    if (e.key !== 'Tab') return;
    const f = [...activeLayer.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!activeLayer.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
    else if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  /* ============ CATALOGUE: search · filter · sort · paginate ============ */

  const state = { q: '', sort: 'featured', category: '', size: '', colour: '', min: null, max: null, inStock: false, page: 1 };
  const ui = {
    search: $('shopSearch'), sort: $('shopSort'),
    category: $('filterCategory'), size: $('filterSize'), colour: $('filterColour'),
    min: $('priceMin'), max: $('priceMax'), stock: $('filterStock'),
    clear: $('shopClear'), clear2: $('shopClear2'), toggle: $('shopFilterToggle'), panel: $('shopFilters'),
    count: $('shopCount'), empty: $('shopEmpty'), pager: $('pagination')
  };

  function fillSelect(select, values) {
    while (select.options.length > 1) select.remove(1);
    values.forEach((v) => select.add(new Option(v, v)));
  }

  function setupFilters() {
    const uniq = (arr) => [...new Set(arr)];
    const cats = uniq(products.map((p) => p.category).filter(Boolean));
    const sizes = uniq(products.flatMap((p) => p.sizes));
    const colours = uniq(products.flatMap((p) => p.colours));
    fillSelect(ui.category, cats);
    fillSelect(ui.size, sizes);
    fillSelect(ui.colour, colours);
    $('fieldCategory').hidden = !cats.length;
    $('fieldSize').hidden = !sizes.length;
    $('fieldColour').hidden = !colours.length;
    $('fieldStock').hidden = !products.some((p) => p.stock != null);
  }

  function readNumber(input) {
    if (input.value === '') return null;
    const n = Number(input.value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function matches(p) {
    if (state.q) {
      const hay = [p.name, p.category, p.description, p.colours.join(' ')].join(' ').toLowerCase();
      if (!state.q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    if (state.category && p.category !== state.category) return false;
    if (state.size && !p.sizes.includes(state.size)) return false;
    if (state.colour && !p.colours.includes(state.colour)) return false;
    if (state.min != null && p.price < state.min) return false;
    if (state.max != null && p.price > state.max) return false;
    if (state.inStock && isSoldOut(p)) return false;
    return true;
  }

  function getFiltered() {
    const out = products.filter(matches);
    const order = new Map(products.map((p, i) => [p.id, i]));
    const sorters = {
      featured: (a, b) => order.get(a.id) - order.get(b.id),
      'price-asc': (a, b) => a.price - b.price || order.get(a.id) - order.get(b.id),
      'price-desc': (a, b) => b.price - a.price || order.get(a.id) - order.get(b.id),
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name)
    };
    return out.sort(sorters[state.sort] || sorters.featured);
  }

  function cardHTML(p, i) {
    const sold = isSoldOut(p);
    const label = sold ? 'Sold out' : hasOptions(p) ? 'Choose options' : 'Add to cart';
    const img = p.images[0]
      ? `<img ${imgAttrs(p.images[0], [400, 600, 900], '(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw')} width="600" height="800" alt="${esc(p.name)}" loading="lazy" decoding="async" />`
      : '';
    return `<article class="product-card" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${esc(money(p.price))}">
      <div class="product-card__img-wrap">
        ${img}
        ${sold ? '<span class="product-card__badge">Sold out</span>' : p.compareAt ? '<span class="product-card__badge">Sale</span>' : ''}
        <button type="button" class="product-card__overlay" data-action="quickview" aria-label="Quick view: ${esc(p.name)}"></button>
      </div>
      <div class="product-card__info">
        <h3 class="product-card__name">${esc(p.name)}</h3>
        <p class="product-card__price">${esc(money(p.price))}${p.compareAt ? ` <s>${esc(money(p.compareAt))}</s>` : ''}</p>
        <button type="button" class="product-card__add" data-action="add"${sold ? ' disabled' : ''}>${label}</button>
      </div>
    </article>`;
  }

  function pageItems(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, cur - 1, cur, cur + 1]);
    if (cur <= 3) [2, 3, 4].forEach((n) => set.add(n));
    if (cur >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => set.add(n));
    const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  function renderPager(total) {
    if (total <= 1) { ui.pager.hidden = true; ui.pager.innerHTML = ''; return; }
    const cur = state.page;
    let h = `<button type="button" class="pagination__btn" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button>`;
    pageItems(cur, total).forEach((n) => {
      h += n === '…'
        ? '<span class="pagination__gap" aria-hidden="true">…</span>'
        : `<button type="button" class="pagination__btn pagination__num" data-page="${n}" aria-label="Page ${n}"${n === cur ? ' aria-current="page"' : ''}>${n}</button>`;
    });
    h += `<button type="button" class="pagination__btn" data-page="${cur + 1}" ${cur === total ? 'disabled' : ''} aria-label="Next page">Next</button>`;
    ui.pager.innerHTML = h;
    ui.pager.hidden = false;
  }

  function activeFilterCount() {
    return [state.category, state.size, state.colour, state.min != null, state.max != null, state.inStock].filter(Boolean).length;
  }

  function render() {
    const results = getFiltered();
    const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const slice = results.slice(start, start + PAGE_SIZE);

    grid.innerHTML = slice.map(cardHTML).join('');
    grid.hidden = slice.length === 0;
    ui.empty.hidden = slice.length !== 0;
    renderPager(pages);

    const noun = results.length === 1 ? 'piece' : 'pieces';
    ui.count.textContent = results.length === 0
      ? 'No pieces found'
      : pages > 1
        ? `Showing ${start + 1}–${start + slice.length} of ${results.length} ${noun}`
        : `${results.length} ${noun}`;

    const n = activeFilterCount();
    ui.toggle.textContent = n ? `Filters (${n})` : 'Filters';
    if (n && window.matchMedia('(max-width: 640px)').matches) {
      ui.panel.classList.add('open'); ui.toggle.setAttribute('aria-expanded', 'true');
    }
    writeUrl();
  }

  function scrollToShop() {
    const top = $('shop').getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /* ---- Shareable URL state (?q=&sort=&cat=&size=&colour=&min=&max=&stock=1&page=) ---- */
  function writeUrl() {
    try {
      const p = new URLSearchParams();
      if (state.q) p.set('q', ui.search.value.trim());
      if (state.sort !== 'featured') p.set('sort', state.sort);
      if (state.category) p.set('cat', state.category);
      if (state.size) p.set('size', state.size);
      if (state.colour) p.set('colour', state.colour);
      if (state.min != null) p.set('min', state.min);
      if (state.max != null) p.set('max', state.max);
      if (state.inStock) p.set('stock', '1');
      if (state.page > 1) p.set('page', state.page);
      const qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (_) { /* history unavailable */ }
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    ui.search.value = p.get('q') || '';
    if ([...ui.sort.options].some((o) => o.value === p.get('sort'))) ui.sort.value = p.get('sort');
    ui.category.value = p.get('cat') || '';
    ui.size.value = p.get('size') || '';
    ui.colour.value = p.get('colour') || '';
    ui.min.value = p.get('min') || '';
    ui.max.value = p.get('max') || '';
    ui.stock.checked = p.get('stock') === '1';
    return parseInt(p.get('page'), 10) || 1;
  }

  function applyFilters(keepPage) {
    state.q = ui.search.value.trim().toLowerCase();
    state.sort = ui.sort.value;
    state.category = ui.category.value;
    state.size = ui.size.value;
    state.colour = ui.colour.value;
    state.min = readNumber(ui.min);
    state.max = readNumber(ui.max);
    state.inStock = ui.stock.checked;
    if (keepPage !== true) state.page = 1;
    render();
  }

  function resetFilters() {
    ui.search.value = ''; ui.sort.value = 'featured';
    ui.category.value = ''; ui.size.value = ''; ui.colour.value = '';
    ui.min.value = ''; ui.max.value = ''; ui.stock.checked = false;
    applyFilters();
  }

  let searchTimer;
  const debounced = () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 180); };
  ui.search.addEventListener('input', debounced);
  ui.min.addEventListener('input', debounced);
  ui.max.addEventListener('input', debounced);
  [ui.sort, ui.category, ui.size, ui.colour, ui.stock].forEach((el) => el.addEventListener('change', applyFilters));
  ui.clear.addEventListener('click', resetFilters);
  ui.clear2.addEventListener('click', resetFilters);
  ui.toggle.addEventListener('click', () => {
    const open = ui.panel.classList.toggle('open');
    ui.toggle.setAttribute('aria-expanded', String(open));
  });

  ui.pager.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    render();
    scrollToShop();
    const cur = ui.pager.querySelector('[aria-current="page"]');
    if (cur) cur.focus({ preventScroll: true });
  });

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    const p = byId.get(card.dataset.id);
    if (!p) return;
    const btn = e.target.closest('[data-action]');
    let action = btn ? btn.dataset.action : null;
    if (!action && e.target.closest('.product-card__name')) action = 'quickview';

    if (action === 'quickview') {
      openQuickView(p);
    } else if (action === 'add') {
      if (hasOptions(p)) { openQuickView(p); toast('Choose your options'); }
      else addToCart(p.id, '', '', 1);
    }
  });

  /* ============ WHATSAPP ============ */

  function openWhatsApp(text) {
    const number = CFG.whatsappNumber;
    if (!number) { toast('WhatsApp number is not configured'); return; }
    toast('Redirecting to WhatsApp…');
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  function orderNow(p, size, colour, qty) {
    const v = variantText(size, colour);
    const text = `Hello, I want to order *${p.name}*${v ? ` (${v})` : ''}${qty > 1 ? ` x${qty}` : ''} for *${money(lineTotal(p, qty))}* from ${BRAND}. Please provide details.`;
    openWhatsApp(text);
  }

  /* ============ CART ============ */

  const cartEl = $('cartDrawer');
  const cartBody = $('cartBody');
  const cartFoot = $('cartFoot');
  const cartCount = $('cartCount');
  const cartToggle = $('cartToggle');
  const keyOf = (id, size, colour) => [id, size || '', colour || ''].join('|');

  function sanitiseCart(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((l) => {
      const p = l && byId.get(String(l.id));
      if (!p) return;
      const size = l.size || '', colour = l.colour || '';
      if (p.sizes.length ? !p.sizes.includes(size) : size) return;
      if (p.colours.length ? !p.colours.includes(colour) : colour) return;
      const max = maxFor(p, size, colour);
      const qty = Math.min(parseInt(l.qty, 10) || 0, max);
      if (qty < 1) return;
      const key = keyOf(p.id, size, colour);
      const dup = out.find((x) => x.key === key);
      if (dup) dup.qty = Math.min(dup.qty + qty, max);
      else out.push({ key, id: p.id, size, colour, qty });
    });
    return out;
  }

  function loadCart() {
    try { return sanitiseCart(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch (_) { return []; }
  }

  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (_) { /* storage unavailable */ }
  }

  function addToCart(id, size, colour, qty) {
    const p = byId.get(id);
    if (!p) return false;
    size = size || ''; colour = colour || '';
    qty = Math.max(1, qty | 0);
    const max = maxFor(p, size, colour);
    if (max <= 0) { toast('Out of stock'); return false; }
    const key = keyOf(id, size, colour);
    const line = cart.find((l) => l.key === key);
    const have = line ? line.qty : 0;
    if (have >= max) { toast(`All ${max} available are already in your cart`); return false; }
    const next = Math.min(max, have + qty);
    if (line) line.qty = next; else cart.push({ key, id, size, colour, qty: next });
    saveCart(); renderCart();
    toast(have + qty > max ? `Only ${max} available — quantity adjusted` : 'Added to cart');
    return true;
  }

  function setQty(key, qty) {
    const line = cart.find((l) => l.key === key);
    const p = line && byId.get(line.id);
    if (!line || !p) return;
    const max = maxFor(p, line.size, line.colour);
    if (qty > max) toast(`Only ${max} available`);
    line.qty = Math.min(Math.max(1, qty | 0), max);
    saveCart(); renderCart();
  }

  function removeLine(key) {
    cart = cart.filter((l) => l.key !== key);
    saveCart(); renderCart();
  }

  function cartLines() {
    return cart.map((l) => ({ l, p: byId.get(l.id) })).filter((x) => x.p);
  }

  function cartTotals() {
    let count = 0, total = 0;
    cartLines().forEach(({ l, p }) => { count += l.qty; total += Math.round(p.price * 100) * l.qty; });
    return { count, total: total / 100 };
  }

  function renderCart() {
    const lines = cartLines();
    const { count, total } = cartTotals();

    cartCount.textContent = count;
    cartCount.hidden = count === 0;
    cartToggle.setAttribute('aria-label', count ? `Open cart, ${count} item${count === 1 ? '' : 's'}` : 'Open cart');

    if (!lines.length) {
      cartBody.innerHTML = '<div class="cart__empty"><p>Your cart is empty.</p><button type="button" class="btn btn--line" data-close>Continue shopping</button></div>';
      cartFoot.hidden = true;
      return;
    }

    cartBody.innerHTML = '<ul class="cart__list">' + lines.map(({ l, p }) => {
      const max = maxFor(p, l.size, l.colour);
      const v = variantText(l.size, l.colour);
      return `<li class="cart-item" data-key="${esc(l.key)}">
        <div class="cart-item__img">${p.images[0] ? `<img ${imgAttrs(p.images[0], [160, 320], '76px')} width="76" height="100" alt="" loading="lazy" decoding="async" />` : ''}</div>
        <div class="cart-item__info">
          <p class="cart-item__name">${esc(p.name)}</p>
          ${v ? `<p class="cart-item__variant">${esc(v)}</p>` : ''}
          <p class="cart-item__unit">${esc(money(p.price))}</p>
          <div class="cart-item__row">
            <div class="qty qty--sm">
              <button type="button" data-cart-action="dec" aria-label="Decrease quantity of ${esc(p.name)}"${l.qty <= 1 ? ' disabled' : ''}>−</button>
              <input type="number" class="cart-item__qty" value="${l.qty}" min="1" max="${max}" inputmode="numeric" aria-label="Quantity of ${esc(p.name)}" />
              <button type="button" data-cart-action="inc" aria-label="Increase quantity of ${esc(p.name)}"${l.qty >= max ? ' disabled' : ''}>+</button>
            </div>
            <p class="cart-item__total">${esc(money(lineTotal(p, l.qty)))}</p>
          </div>
          <button type="button" class="cart-item__remove" data-cart-action="remove" aria-label="Remove ${esc(p.name)} from cart">Remove</button>
        </div>
      </li>`;
    }).join('') + '</ul>';

    $('cartTotal').textContent = money(total);
    $('cartNote').textContent = 'Checkout is completed on WhatsApp.' + (CFG.deliveryNote ? ' ' + CFG.deliveryNote : '');
    cartFoot.hidden = false;
  }

  function refocusCart(key, action) {
    const item = [...cartBody.querySelectorAll('.cart-item')].find((n) => n.dataset.key === key);
    const target = item && (item.querySelector(`[data-cart-action="${action}"]:not([disabled])`) || item.querySelector('.cart-item__qty'));
    (target || cartEl.querySelector(FOCUSABLE) || cartEl).focus({ preventScroll: true });
  }

  cartBody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cart-action]');
    if (!b) return;
    const item = b.closest('.cart-item');
    const key = item.dataset.key;
    const line = cart.find((l) => l.key === key);
    if (!line) return;
    const action = b.dataset.cartAction;
    if (action === 'inc') setQty(key, line.qty + 1);
    else if (action === 'dec') setQty(key, line.qty - 1);
    else if (action === 'remove') {
      const p = byId.get(line.id);
      removeLine(key);
      toast(`${p ? p.name : 'Item'} removed`);
      cartEl.querySelector(FOCUSABLE) && (cartBody.querySelector(FOCUSABLE) || cartEl.querySelector('.cart__close')).focus({ preventScroll: true });
      return;
    }
    refocusCart(key, action);
  });

  cartBody.addEventListener('change', (e) => {
    if (!e.target.classList.contains('cart-item__qty')) return;
    const key = e.target.closest('.cart-item').dataset.key;
    const n = parseInt(e.target.value, 10);
    setQty(key, Number.isFinite(n) ? n : 1);
    refocusCart(key, 'inc');
  });

  $('cartClear').addEventListener('click', () => {
    cart = []; saveCart(); renderCart();
    toast('Cart cleared');
    cartEl.querySelector('.cart__close').focus({ preventScroll: true });
  });

  $('cartCheckout').addEventListener('click', () => {
    const lines = cartLines();
    if (!lines.length) return;
    const { total } = cartTotals();
    if (typeof CFG.onCheckout === 'function') {
      CFG.onCheckout({
        items: lines.map(({ l, p }) => ({ id: p.id, name: p.name, size: l.size, colour: l.colour, quantity: l.qty, unitPrice: p.price })),
        total, currency: CFG.currencyCode || 'NGN'
      });
      return;
    }
    const rows = lines.map(({ l, p }, i) => {
      const v = variantText(l.size, l.colour);
      return `${i + 1}. ${p.name}${v ? ` (${v})` : ''} — ${l.qty} × ${money(p.price)} = ${money(lineTotal(p, l.qty))}`;
    });
    openWhatsApp(`Hello, I want to order the following from ${BRAND}:\n\n${rows.join('\n')}\n\nTotal: ${money(total)}\n\nPlease provide details.`);
  });

  cartToggle.addEventListener('click', () => openLayer(cartEl));
  cartEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeLayer(cartEl);
      if (e.target.closest('.cart__empty')) {
        const c = $('collection');
        if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
      }
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { cart = loadCart(); renderCart(); }
  });

  /* ============ QUICK VIEW ============ */

  const qv = $('quickView');
  const qvContent = $('qvContent');
  const qvPanel = qv.querySelector('.qv__panel');
  let qvState = null;

  function optionGroup(type, label, values) {
    if (!values.length) return '';
    return `<div class="qv__group" role="group" aria-label="${label}">
      <p class="qv__label">${label}<span class="qv__sel" data-sel="${type}"></span></p>
      <div class="qv__opts">${values.map((v) => `<button type="button" class="qv__opt" data-opt="${type}" data-value="${esc(v)}" aria-pressed="false">${esc(v)}</button>`).join('')}</div>
    </div>`;
  }

  function qvHTML(p) {
    const imgs = p.images;
    const gallery = imgs.length
      ? `<div class="qv__main"><img id="qvMainImg" ${imgAttrs(imgs[0], [600, 900, 1200], '(max-width: 760px) 100vw, 520px')} alt="${esc(p.name)}" decoding="async" /></div>` +
        (imgs.length > 1
          ? `<div class="qv__thumbs">${imgs.map((src, i) => `<button type="button" class="qv__thumb" data-thumb="${i}" aria-label="Show image ${i + 1} of ${imgs.length}" aria-current="${i === 0}"><img src="${esc(src)}" alt="" loading="lazy" /></button>`).join('')}</div>`
          : '')
      : '<div class="qv__main qv__main--empty" aria-hidden="true"></div>';
    return `<div class="qv__gallery">${gallery}</div>
      <div class="qv__info">
        ${p.category ? `<p class="qv__category">${esc(p.category)}</p>` : ''}
        <h3 class="qv__title" id="qvTitle">${esc(p.name)}</h3>
        <p class="qv__price">${esc(money(p.price))}${p.compareAt ? ` <s>${esc(money(p.compareAt))}</s>` : ''}</p>
        ${p.description ? `<p class="qv__desc">${esc(p.description)}</p>` : ''}
        ${optionGroup('size', 'Size', p.sizes)}
        ${optionGroup('colour', 'Colour', p.colours)}
        <p class="qv__stock" id="qvStock" role="status"></p>
        <div class="qv__qtyrow">
          <span class="qv__label" id="qvQtyLabel">Quantity</span>
          <div class="qty" role="group" aria-labelledby="qvQtyLabel">
            <button type="button" data-qv-qty="-1" aria-label="Decrease quantity">−</button>
            <input type="number" id="qvQty" min="1" value="1" inputmode="numeric" aria-label="Quantity" />
            <button type="button" data-qv-qty="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div class="qv__actions">
          <button type="button" class="btn btn--solid" id="qvAdd">Add to cart</button>
          <button type="button" class="btn btn--line" id="qvOrder">Order on WhatsApp</button>
        </div>
        ${CFG.deliveryNote ? `<p class="qv__note">${esc(CFG.deliveryNote)}</p>` : ''}
        <p class="qv__msg" id="qvMsg" role="alert"></p>
      </div>`;
  }

  function openQuickView(p) {
    qvState = { p, size: p.sizes.length === 1 ? p.sizes[0] : '', colour: p.colours.length === 1 ? p.colours[0] : '', qty: 1 };
    qvContent.innerHTML = qvHTML(p);
    syncQV();
    qvPanel.scrollTop = 0;
    openLayer(qv);
  }

  function syncQV() {
    const s = qvState;
    if (!s) return;
    const { p } = s;
    qvContent.querySelectorAll('.qv__opt').forEach((b) => {
      const type = b.dataset.opt, v = b.dataset.value;
      const selected = (type === 'size' ? s.size : s.colour) === v;
      const stock = type === 'size' ? stockFor(p, v, s.colour) : stockFor(p, s.size, v);
      b.setAttribute('aria-pressed', String(selected));
      b.disabled = stock === 0;
    });
    qvContent.querySelectorAll('.qv__sel').forEach((n) => {
      const v = n.dataset.sel === 'size' ? s.size : s.colour;
      n.textContent = v ? `: ${v}` : '';
    });

    const stock = stockFor(p, s.size, s.colour);
    const incomplete = (p.sizes.length && !s.size) || (p.colours.length && !s.colour);
    const stockEl = $('qvStock');
    stockEl.className = 'qv__stock';
    if (p.stock == null) stockEl.textContent = '';
    else if (stock === 0) { stockEl.textContent = 'Out of stock'; stockEl.classList.add('qv__stock--out'); }
    else if (stock != null) stockEl.textContent = `${stock} in stock`;
    else stockEl.textContent = incomplete ? 'Select options to see availability' : '';

    const max = maxFor(p, s.size, s.colour);
    s.qty = Math.min(Math.max(1, s.qty), Math.max(1, max));
    $('qvQty').value = s.qty;
    $('qvQty').max = max;
    const unavailable = stock === 0 || isSoldOut(p);
    $('qvAdd').disabled = unavailable;
    $('qvOrder').disabled = unavailable;
    $('qvAdd').textContent = unavailable ? 'Sold out' : 'Add to cart';
    const dec = qvContent.querySelector('[data-qv-qty="-1"]');
    const inc = qvContent.querySelector('[data-qv-qty="1"]');
    dec.disabled = s.qty <= 1;
    inc.disabled = s.qty >= max;
  }

  function qvValidate() {
    const s = qvState;
    const msg = $('qvMsg');
    msg.textContent = '';
    if (s.p.sizes.length && !s.size) { msg.textContent = 'Please select a size.'; return false; }
    if (s.p.colours.length && !s.colour) { msg.textContent = 'Please select a colour.'; return false; }
    return true;
  }

  qvContent.addEventListener('click', (e) => {
    const s = qvState;
    if (!s) return;
    const opt = e.target.closest('.qv__opt');
    const thumb = e.target.closest('[data-thumb]');
    const step = e.target.closest('[data-qv-qty]');
    $('qvMsg').textContent = '';

    if (opt && !opt.disabled) {
      if (opt.dataset.opt === 'size') {
        s.size = opt.dataset.value;
        if (s.colour && stockFor(s.p, s.size, s.colour) === 0) s.colour = '';
      } else {
        s.colour = opt.dataset.value;
        if (s.size && stockFor(s.p, s.size, s.colour) === 0) s.size = '';
      }
      syncQV();
    } else if (thumb) {
      const i = Number(thumb.dataset.thumb);
      const main = $('qvMainImg');
      main.removeAttribute('srcset');
      main.src = s.p.images[i];
      qvContent.querySelectorAll('.qv__thumb').forEach((t) => t.setAttribute('aria-current', String(t === thumb)));
    } else if (step && !step.disabled) {
      s.qty += Number(step.dataset.qvQty);
      syncQV();
    } else if (e.target.closest('#qvAdd')) {
      if (!qvValidate()) return;
      if (addToCart(s.p.id, s.size, s.colour, s.qty)) {
        closeLayer(qv, false);
        openLayer(cartEl);
      }
    } else if (e.target.closest('#qvOrder')) {
      if (!qvValidate()) return;
      orderNow(s.p, s.size, s.colour, s.qty);
    }
  });

  qvContent.addEventListener('change', (e) => {
    if (e.target.id !== 'qvQty' || !qvState) return;
    const n = parseInt(e.target.value, 10);
    qvState.qty = Number.isFinite(n) ? n : 1;
    syncQV();
  });

  qv.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeLayer(qv);
  });

  /* ============ SEO: Product structured data ============ */

  function injectStructuredData() {
    let el = $('ld-products');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'ld-products';
      document.head.appendChild(el);
    }
    const data = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: products.map((p, i) => {
        const item = {
          '@type': 'Product', name: p.name, brand: { '@type': 'Brand', name: BRAND },
          offers: { '@type': 'Offer', price: p.price, priceCurrency: CFG.currencyCode || 'NGN' }
        };
        if (p.images.length) item.image = p.images;
        if (p.description) item.description = p.description;
        if (p.category) item.category = p.category;
        if (p.stock != null) item.offers.availability = 'https://schema.org/' + (isSoldOut(p) ? 'OutOfStock' : 'InStock');
        return { '@type': 'ListItem', position: i + 1, item };
      })
    };
    el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }

  /* ============ INIT / PUBLIC API ============ */

  /* ---- Remote catalogue status (loading / error). Never touches the saved cart. ---- */
  const errBox = $('shopError');
  const REMOTE = !!(window.ZALIELS_FIREBASE && window.ZALIELS_FIREBASE.enabled);
  let retryFn = null;

  function setLoading() {
    if (errBox) errBox.hidden = true;
    grid.hidden = true; ui.empty.hidden = true; ui.pager.hidden = true;
    ui.count.textContent = 'Loading collection…';
  }

  function setError(msg, onRetry) {
    retryFn = typeof onRetry === 'function' ? onRetry : null;
    grid.hidden = true; ui.empty.hidden = true; ui.pager.hidden = true;
    ui.count.textContent = '';
    if (errBox) {
      $('shopErrorMsg').textContent = msg || "We couldn't load the collection. Please check your connection and try again.";
      $('shopRetry').hidden = !retryFn;
      errBox.hidden = false;
    }
  }

  if ($('shopRetry')) $('shopRetry').addEventListener('click', () => { if (retryFn) retryFn(); });

  let firstInit = true;
  function setProducts(input) {
    if (errBox) errBox.hidden = true;
    products = (Array.isArray(input) ? input : [])
      .filter((p) => p && p.id != null && p.name && Number.isFinite(Number(p.price)))
      .map(normalise);
    byId = new Map(products.map((p) => [p.id, p]));
    cart = sanitiseCart(cart.length ? cart : loadCart());
    saveCart();
    setupFilters();
    if (firstInit) {
      firstInit = false;
      const page = readUrl();
      state.page = page;
      applyFilters(true);
    } else {
      resetFilters();
    }
    renderCart();
    injectStructuredData();
  }

  Z.setProducts = setProducts;
  Z.setLoading = setLoading;
  Z.setError = setError;
  Z.remote = REMOTE;
  // Firebase configured: catalogue.js supplies products from Firestore (shows loading first).
  // Not configured: keep using the static catalogue in products.js exactly as before.
  if (REMOTE) setLoading();
  else setProducts(window.ZALIELS_PRODUCTS);
})();
