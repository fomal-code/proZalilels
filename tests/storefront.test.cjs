// Run: NODE_PATH=<dir with jsdom> node tests/storefront.test.cjs
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function boot(enabled) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  w.scrollTo = () => {};
  w.eval(read('products.js'));
  w.eval(read('firebase-config.js'));
  if (enabled) w.ZALIELS_FIREBASE.enabled = true;
  w.eval(read('script.js')); w.eval(read('shop.js'));
  return w;
}

// 1. Firebase NOT configured -> placeholders detected, static catalogue renders as before
let w = boot(false);
assert.strictEqual(w.ZALIELS_FIREBASE.enabled, false);
assert.strictEqual(w.document.querySelectorAll('.product-card').length, 6);
assert.ok(w.document.getElementById('shopCount').textContent.includes('6'));
w.document.querySelector('[data-action=add]').click();
assert.ok(JSON.parse(w.localStorage.getItem('zaliels_cart_v1')).length === 1, 'add to cart still works');
console.log('static mode ok (6 cards, cart works)');

// 2. Remote mode: loading state, saved cart untouched, then products, empty, error+retry
w = boot(true);
w.localStorage.setItem('zaliels_cart_v1', JSON.stringify([{ key: 'a||', id: 'a', size: '', colour: '', qty: 2 }]));
w.Zaliels.setLoading();
assert.strictEqual(w.document.querySelectorAll('.product-card').length, 0);
assert.ok(w.document.getElementById('shopCount').textContent.includes('Loading'));
assert.ok(w.localStorage.getItem('zaliels_cart_v1').includes('"a"'), 'loading must not wipe cart');
w.Zaliels.setProducts([{ id: 'a', name: 'Alpha', price: 1000, images: ['https://x/y.jpg'], sizes: [], colours: [], stock: 5 }]);
assert.strictEqual(w.document.querySelectorAll('.product-card').length, 1);
assert.ok(JSON.parse(w.localStorage.getItem('zaliels_cart_v1')).length === 1, 'cart preserved after load');
w.Zaliels.setProducts([]);
assert.strictEqual(w.document.getElementById('shopEmpty').hidden, false);
let retried = 0; w.Zaliels.setError('boom', () => retried++);
assert.strictEqual(w.document.getElementById('shopError').hidden, false);
assert.strictEqual(w.document.getElementById('shopErrorMsg').textContent, 'boom');
w.document.getElementById('shopRetry').click(); assert.strictEqual(retried, 1);
w.Zaliels.setProducts([{ id: 'b', name: 'Beta', price: 5, images: [] }]);
assert.strictEqual(w.document.getElementById('shopError').hidden, true);
console.log('remote mode ok (loading / products / empty / error+retry, cart preserved)');
