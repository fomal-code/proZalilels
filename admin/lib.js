/* ZALIELS admin — pure helpers (no Firebase, no DOM). Unit-tested in tests/lib.test.mjs */

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const MAX_IMAGES = 12;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

export function slugify(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function uniqueList(values) {
  const seen = new Set(), out = [];
  (values || []).forEach((v) => {
    const s = String(v == null ? '' : v).trim();
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  });
  return out;
}

// Keys follow the storefront convention: 'Size|Colour', 'Size' or 'Colour'.
export function variantKeys(sizes, colours) {
  if (sizes.length && colours.length) return sizes.flatMap((s) => colours.map((c) => s + '|' + c));
  if (sizes.length) return sizes.slice();
  if (colours.length) return colours.slice();
  return [];
}

// mode: 'none' | 'total' | 'variants'. Returns null (unknown), a number, or an object.
export function buildStock(mode, total, variants, sizes, colours) {
  if (mode === 'total') {
    const n = parseInt(total, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (mode === 'variants') {
    const keys = variantKeys(sizes, colours);
    if (!keys.length) return buildStock('total', total, variants, sizes, colours);
    const out = {};
    keys.forEach((k) => {
      const n = parseInt(variants && variants[k], 10);
      out[k] = Number.isFinite(n) && n >= 0 ? n : 0;
    });
    return out;
  }
  return null;
}

export function stockToForm(stock) {
  if (stock == null) return { mode: 'none', total: '', variants: {} };
  if (typeof stock === 'number') return { mode: 'total', total: String(stock), variants: {} };
  if (typeof stock === 'object') return { mode: 'variants', total: '', variants: { ...stock } };
  return { mode: 'none', total: '', variants: {} };
}

export function stockSummary(stock) {
  if (stock == null) return 'Not tracked';
  if (typeof stock === 'number') return stock <= 0 ? 'Sold out' : stock + ' in stock';
  const vals = Object.values(stock).filter((x) => typeof x === 'number');
  if (!vals.length) return 'Not tracked';
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum <= 0 ? 'Sold out' : sum + ' in stock';
}

// Validates form values and returns { errors: {field: msg}, data } where data is the Firestore payload (no timestamps).
export function buildProductData(f) {
  const errors = {};
  const name = String(f.name || '').trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > 200) errors.name = 'Name is too long (max 200).';

  const price = Number(f.price);
  if (f.price === '' || f.price == null || !Number.isFinite(price) || price < 0) errors.price = 'Enter a valid price (0 or more).';

  let compareAt = null;
  if (f.compareAt !== '' && f.compareAt != null) {
    const c = Number(f.compareAt);
    if (!Number.isFinite(c) || c < 0) errors.compareAt = 'Enter a valid number.';
    else if (Number.isFinite(price) && c <= price) errors.compareAt = 'Must be higher than the price (or leave empty).';
    else compareAt = c;
  }

  const sizes = uniqueList(f.sizes), colours = uniqueList(f.colours);
  const description = String(f.description || '').trim();
  if (description.length > 5000) errors.description = 'Description is too long (max 5000).';
  const category = String(f.category || '').trim();
  if (category.length > 100) errors.category = 'Category is too long (max 100).';

  if ((f.images || []).length > MAX_IMAGES) errors.images = 'A product can have at most ' + MAX_IMAGES + ' images.';

  let sortOrder = null;
  if (f.sortOrder !== '' && f.sortOrder != null) {
    const s = Number(f.sortOrder);
    if (!Number.isFinite(s)) errors.sortOrder = 'Enter a number.';
    else sortOrder = s;
  }

  const stock = buildStock(f.stockMode, f.stockTotal, f.stockVariants, sizes, colours);

  const data = {
    name, price: Number.isFinite(price) ? price : 0, compareAt, description, category, sizes, colours, stock,
    published: !!f.published
  };
  if (sortOrder != null) data.sortOrder = sortOrder;
  return { errors, data };
}

// Seed product (from products.js) -> Firestore payload (id is the document ID, never a field).
export function seedToDoc(p, sortOrder) {
  const arr = (v) => (Array.isArray(v) ? uniqueList(v) : []);
  const images = Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []);
  let stock = p.stock === undefined ? null : p.stock;
  if (stock !== null && typeof stock !== 'number' && (typeof stock !== 'object' || Array.isArray(stock))) stock = null;
  return {
    name: String(p.name),
    price: Number(p.price),
    compareAt: Number(p.compareAt) > Number(p.price) ? Number(p.compareAt) : null,
    images: images.filter((x) => typeof x === 'string' && x).slice(0, MAX_IMAGES),
    description: p.description ? String(p.description) : '',
    category: p.category ? String(p.category) : '',
    sizes: arr(p.sizes),
    colours: arr(p.colours),
    stock,
    published: true,
    sortOrder
  };
}

export function validateSeed(p) {
  if (!p || p.id == null || String(p.id) === '') return 'missing id';
  if (!ID_PATTERN.test(String(p.id))) return 'id has characters not allowed in a document ID';
  if (!p.name) return 'missing name';
  if (!Number.isFinite(Number(p.price)) || Number(p.price) < 0) return 'invalid price';
  return '';
}

// https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?alt=media&token=...  ->  decoded path, else ''
export function storagePathFromUrl(url, bucket) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'firebasestorage.googleapis.com') return '';
    const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);
    if (!m || (bucket && m[1] !== bucket)) return '';
    const path = decodeURIComponent(m[2]);
    return path.startsWith('products/') ? path : '';
  } catch (_) { return ''; }
}

export function safeFileName(name) {
  const dot = String(name).lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : '';
  const clean = slugify(base) || 'image';
  return clean + (ext ? '.' + ext : '');
}

export function isHttpsUrl(s) {
  try { return new URL(s).protocol === 'https:'; } catch (_) { return false; }
}

export function formatPrice(n, symbol) {
  return (symbol || '₦') + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 });
}
