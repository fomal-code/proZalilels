import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../admin/lib.js';

assert.equal(L.slugify('Àṣọ Silk & Lace Dress!'), 'aso-silk-and-lace-dress');
assert.deepEqual(L.uniqueList([' S', 's', 'M', '', null]), ['S', 'M']);
assert.deepEqual(L.variantKeys(['S', 'M'], ['Black']), ['S|Black', 'M|Black']);
assert.deepEqual(L.variantKeys(['S'], []), ['S']);
assert.equal(L.buildStock('none'), null);
assert.equal(L.buildStock('total', '5'), 5);
assert.deepEqual(L.buildStock('variants', '', { 'S|Black': '3' }, ['S', 'M'], ['Black']), { 'S|Black': 3, 'M|Black': 0 });
assert.equal(L.buildStock('variants', '7', {}, [], []), 7);
assert.equal(L.stockSummary({ a: 0, b: 0 }), 'Sold out');
assert.equal(L.stockSummary(null), 'Not tracked');

let r = L.buildProductData({ name: '', price: '', stockMode: 'none' });
assert.ok(r.errors.name && r.errors.price);
r = L.buildProductData({ name: 'X', price: '100', compareAt: '90', stockMode: 'none' });
assert.ok(r.errors.compareAt);
r = L.buildProductData({ name: 'X', price: '100', compareAt: '150', sizes: ['S'], colours: [], stockMode: 'variants', stockVariants: { S: '2' }, published: true, images: [] });
assert.deepEqual(r.errors, {});
assert.deepEqual(r.data.stock, { S: 2 });
assert.equal(r.data.compareAt, 150);

// Seed migration mapping against the real products.js
global.window = {};
new Function('window', fs.readFileSync(new URL('../products.js', import.meta.url), 'utf8'))(global.window);
const seeds = global.window.ZALIELS_PRODUCTS;
assert.equal(seeds.length, 6);
const ids = new Set();
seeds.forEach((p, i) => {
  assert.equal(L.validateSeed(p), '');
  ids.add(p.id);
  const d = L.seedToDoc(p, i);
  assert.equal(d.name, p.name); assert.equal(d.price, p.price);
  assert.deepEqual(d.images, p.images); assert.equal(d.stock, null); assert.equal(d.published, true);
  // only fields allowed by firestore.rules
  const allowed = ['name','price','compareAt','images','description','category','sizes','colours','stock','published','sortOrder'];
  Object.keys(d).forEach((k) => assert.ok(allowed.includes(k), k));
});
assert.equal(ids.size, 6);
assert.ok(L.validateSeed({ id: 'bad id!', name: 'x', price: 1 }));

const b = 'proj.firebasestorage.app';
assert.equal(L.storagePathFromUrl('https://firebasestorage.googleapis.com/v0/b/proj.firebasestorage.app/o/products%2Fa%2Fb.webp?alt=media&token=t', b), 'products/a/b.webp');
assert.equal(L.storagePathFromUrl('https://images.unsplash.com/x', b), '');
assert.equal(L.storagePathFromUrl('https://firebasestorage.googleapis.com/v0/b/other/o/products%2Fa.webp', b), '');
assert.equal(L.safeFileName('My Photo.JPG'), 'my-photo.jpg');
assert.equal(L.isHttpsUrl('http://x.com'), false);
console.log('lib tests passed');
