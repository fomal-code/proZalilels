/* ZALIELS admin dashboard — Firebase Auth + Firestore + Storage (modular SDK from the official CDN).
   Authorisation is enforced by firestore.rules / storage.rules. The checks in this file are UX only. */
import {
  ID_PATTERN, MAX_IMAGES, MAX_UPLOAD_BYTES, ALLOWED_TYPES, slugify, uniqueList, variantKeys, stockToForm,
  stockSummary, buildProductData, seedToDoc, validateSeed, storagePathFromUrl, safeFileName, isHttpsUrl, formatPrice
} from './lib.js';

const FB = window.ZALIELS_FIREBASE;
const $ = (id) => document.getElementById(id);
const VIEWS = ['viewConfig', 'viewLoading', 'viewLogin', 'viewDenied', 'viewApp'];
const show = (id) => VIEWS.forEach((v) => { $(v).hidden = v !== id; });
const SYMBOL = (window.ZALIELS_CONFIG && window.ZALIELS_CONFIG.currencySymbol) || '₦';

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c != null) n.append(c); });
  return n;
}

function toast(msg, isErr) {
  const t = el('div', { class: 'toast' + (isErr ? ' toast--err' : ''), text: msg });
  $('toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}

function friendly(err) {
  const c = (err && err.code) || '';
  if (c === 'permission-denied' || c === 'storage/unauthorized')
    return 'Permission denied. Make sure your account has a document at admins/<your UID> and that firestore.rules and storage.rules are published.';
  if (c === 'unavailable' || c === 'auth/network-request-failed') return 'Network problem. Check your connection and try again.';
  if (c.startsWith('storage/')) return 'Image upload failed (' + c + '). If Cloud Storage is not enabled for this project, paste image URLs instead.';
  return (err && err.message) || 'Something went wrong.';
}

if (!FB || !FB.enabled) {
  show('viewConfig');
} else {
  init().catch((err) => {
    console.error(err);
    show('viewConfig');
    $('viewConfig').querySelector('h1').textContent = 'Could not start the dashboard';
    $('viewConfig').querySelector('p').textContent = 'The Firebase SDK failed to load: ' + friendly(err);
  });
}

async function init() {
  const base = 'https://www.gstatic.com/firebasejs/' + FB.sdkVersion + '/';
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
  ]);
  const app = initializeApp(FB.config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  let S = null; // Storage SDK, loaded on first use
  const storage = async () => {
    if (!S) { const m = await import(base + 'firebase-storage.js'); S = { m, st: m.getStorage(app) }; }
    return S;
  };

  let user = null, products = [], unsubProducts = null;

  /* ================= AUTH ================= */
  const authMsg = (e) => {
    const c = e && e.code;
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(c)) return 'Incorrect email or password.';
    if (c === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes or reset your password.';
    if (c === 'auth/user-disabled') return 'This account has been disabled.';
    return friendly(e);
  };

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('loginEmail').value.trim(), pw = $('loginPassword').value;
    $('loginError').textContent = '';
    if (!email || !pw) { $('loginError').textContent = 'Enter your email and password.'; return; }
    $('loginBtn').disabled = true;
    try { await A.signInWithEmailAndPassword(auth, email, pw); }
    catch (err) { $('loginError').textContent = authMsg(err); }
    finally { $('loginBtn').disabled = false; }
  });

  $('resetBtn').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim();
    if (!email) { $('loginError').textContent = 'Enter your email above first.'; return; }
    try { await A.sendPasswordResetEmail(auth, email); } catch (err) { if (err.code === 'auth/network-request-failed') { $('loginError').textContent = authMsg(err); return; } }
    $('loginError').textContent = '';
    toast('If that account exists, a reset email has been sent.');
  });

  document.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => A.signOut(auth)));

  A.onAuthStateChanged(auth, async (u) => {
    user = u;
    if (unsubProducts) { unsubProducts(); unsubProducts = null; }
    products = [];
    if (!u) { $('loginPassword').value = ''; show('viewLogin'); return; }
    show('viewLoading');
    let isAdmin = false;
    try { isAdmin = (await F.getDoc(F.doc(db, 'admins', u.uid))).exists(); }
    catch (err) { if (err.code !== 'permission-denied') toast(friendly(err), true); }
    if (!isAdmin) { $('deniedEmail').textContent = u.email || u.uid; show('viewDenied'); return; }
    $('userEmail').textContent = u.email || '';
    show('viewApp');
    startProducts();
    refreshMigrationInfo();
  });

  /* ================= TABS ================= */
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    $('panelProducts').hidden = t.dataset.tab !== 'products';
    $('panelMigration').hidden = t.dataset.tab !== 'migration';
  }));

  /* ================= PRODUCT LIST ================= */
  const byOrder = (a, b) => (a.sortOrder ?? 1e15) - (b.sortOrder ?? 1e15) || String(a.name).localeCompare(String(b.name));

  function startProducts() {
    $('listMsg').textContent = 'Loading products…';
    unsubProducts = F.onSnapshot(F.collection(db, 'products'), (snap) => {
      products = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
      $('listMsg').textContent = '';
      renderList();
      $('categoryList').replaceChildren(...uniqueList(products.map((p) => p.category)).map((c) => el('option', { value: c })));
    }, (err) => {
      console.error(err);
      $('listMsg').textContent = 'Could not load products: ' + friendly(err);
    });
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase(), st = $('statusFilter').value;
    const rows = products.filter((p) => {
      if (st === 'published' && !p.published) return false;
      if (st === 'draft' && p.published) return false;
      return !q || [p.name, p.category, p.id].join(' ').toLowerCase().includes(q);
    });
    if (!rows.length) {
      $('list').replaceChildren(el('p', { class: 'muted', text: products.length ? 'No products match your search.' : 'No products yet. Add one, or import your existing catalogue from the Migration tab.' }));
      return;
    }
    $('list').replaceChildren(...rows.map((p) => el('article', { class: 'item' },
      el('div', { class: 'item__img' }, p.images && p.images[0] ? el('img', { src: p.images[0], alt: '', loading: 'lazy' }) : null),
      el('div', {},
        el('p', { class: 'item__name', text: p.name }),
        el('p', { class: 'item__meta' },
          el('span', { text: formatPrice(p.price, SYMBOL) + (p.compareAt ? ' (was ' + formatPrice(p.compareAt, SYMBOL) + ')' : '') }),
          el('span', { text: p.category || 'No category' }),
          el('span', { text: stockSummary(p.stock) }),
          el('span', { class: 'badge ' + (p.published ? 'badge--on' : 'badge--off'), text: p.published ? 'Published' : 'Unpublished' }))),
      el('div', { class: 'item__actions' },
        el('button', { class: 'btn btn--line btn--sm', type: 'button', text: p.published ? 'Unpublish' : 'Publish', onclick: () => togglePublished(p) }),
        el('button', { class: 'btn btn--line btn--sm', type: 'button', text: 'Edit', onclick: () => openEditor(p) }),
        el('button', { class: 'btn btn--line btn--sm', type: 'button', text: 'Delete', onclick: () => deleteProduct(p) })))));
  }
  $('search').addEventListener('input', renderList);
  $('statusFilter').addEventListener('change', renderList);

  async function togglePublished(p) {
    try {
      await F.updateDoc(F.doc(db, 'products', p.id), { published: !p.published, updatedAt: F.serverTimestamp() });
      toast(p.published ? 'Unpublished' : 'Published');
    } catch (err) { toast(friendly(err), true); }
  }

  /* ---- generic confirm dialog ---- */
  function askConfirm(title, text, yes) {
    return new Promise((resolve) => {
      const d = $('confirm');
      $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmYes').textContent = yes || 'Delete';
      const done = (v) => { d.close(); $('confirmYes').onclick = $('confirmNo').onclick = null; d.onclose = null; resolve(v); };
      $('confirmYes').onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
      d.onclose = () => resolve(false);
      d.showModal();
    });
  }

  async function removeStorageUrls(urls) {
    const paths = urls.map((u) => storagePathFromUrl(u, FB.config.storageBucket)).filter(Boolean);
    if (!paths.length) return 0;
    let failed = 0;
    try {
      const { m, st } = await storage();
      for (const path of paths) { try { await m.deleteObject(m.ref(st, path)); } catch (e) { if (e.code !== 'storage/object-not-found') failed++; } }
    } catch (e) { failed = paths.length; }
    return failed;
  }

  async function deleteProduct(p) {
    const ok = await askConfirm('Delete “' + p.name + '”?', 'This permanently removes the product and any images uploaded for it. This cannot be undone. (To hide it temporarily, use Unpublish instead.)');
    if (!ok) return;
    try {
      await F.deleteDoc(F.doc(db, 'products', p.id));
      const failed = await removeStorageUrls(p.images || []);
      toast(failed ? 'Product deleted, but ' + failed + ' image file(s) could not be removed.' : 'Product deleted', !!failed);
    } catch (err) { toast(friendly(err), true); }
  }

  /* ================= EDITOR ================= */
  const dlg = $('editor');
  let ed = null;
  const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  $('addBtn').addEventListener('click', () => openEditor(null));
  $('editorClose').addEventListener('click', () => dlg.close());
  $('editorCancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (ed) ed.images.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)); ed = null; });

  function openEditor(p) {
    const sf = stockToForm(p ? p.stock : null);
    ed = {
      id: p ? p.id : null, isNew: !p, original: p || null,
      sizes: p ? [...(p.sizes || [])] : [], colours: p ? [...(p.colours || [])] : [],
      images: p ? (p.images || []).map((url) => ({ url })) : [], removed: [],
      stockVariants: sf.variants
    };
    $('editorTitle').textContent = p ? 'Edit product' : 'Add product';
    $('fName').value = p ? p.name : '';
    $('fPrice').value = p ? p.price : '';
    $('fCompare').value = p && p.compareAt ? p.compareAt : '';
    $('fCategory').value = p ? p.category || '' : '';
    $('fOrder').value = p && typeof p.sortOrder === 'number' ? p.sortOrder : '';
    $('fDesc').value = p ? p.description || '' : '';
    $('fPublished').checked = p ? !!p.published : true;
    $('fStockTotal').value = sf.total;
    document.querySelector('input[name=stockMode][value=' + sf.mode + ']').checked = true;
    $('fUrl').value = ''; $('fFiles').value = '';
    $('formError').textContent = ''; $('saveStatus').textContent = '';
    dlg.querySelectorAll('[data-err]').forEach((n) => { n.textContent = ''; });
    $('saveBtn').disabled = false;
    renderChips('sizes'); renderChips('colours'); renderStock(); renderImages();
    dlg.showModal();
    dlg.querySelector('.dlg__body').scrollTop = 0;
    $('fName').focus();
  }

  /* ---- chips (sizes / colours) ---- */
  const chipInputs = {};
  document.querySelectorAll('[data-chips]').forEach((box) => {
    const kind = box.dataset.chips;
    const input = el('input', { type: 'text', 'aria-label': 'Add ' + kind.replace(/s$/, ''), placeholder: kind === 'sizes' ? 'Type a size, press Enter' : 'Type a colour, press Enter', maxlength: '40' });
    chipInputs[kind] = input; box.append(input);
    const commit = () => {
      input.value.split(',').forEach((v) => addChip(kind, v));
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value && ed && ed[kind].length) { ed[kind].pop(); renderChips(kind); renderStock(); }
    });
    input.addEventListener('blur', commit);
  });

  function addChip(kind, v) {
    v = v.trim();
    if (!v || !ed) return;
    if (ed[kind].some((x) => x.toLowerCase() === v.toLowerCase())) return;
    if (ed[kind].length >= 40) { toast('Maximum 40 values.', true); return; }
    ed[kind].push(v); renderChips(kind); renderStock();
  }

  function renderChips(kind) {
    const box = document.querySelector('[data-chips=' + kind + ']');
    box.querySelectorAll('.chip').forEach((c) => c.remove());
    ed[kind].forEach((v, i) => box.insertBefore(el('span', { class: 'chip' }, v,
      el('button', { type: 'button', 'aria-label': 'Remove ' + v, text: '✕', onclick: () => { ed[kind].splice(i, 1); renderChips(kind); renderStock(); } })), chipInputs[kind]));
    if (kind === 'sizes') {
      $('sizePresets').replaceChildren(...SIZE_PRESETS.filter((s) => !ed.sizes.some((x) => x.toLowerCase() === s.toLowerCase()))
        .map((s) => el('button', { type: 'button', text: '+ ' + s, onclick: () => addChip('sizes', s) })));
    }
  }

  /* ---- stock ---- */
  const stockMode = () => document.querySelector('input[name=stockMode]:checked').value;
  document.querySelectorAll('input[name=stockMode]').forEach((r) => r.addEventListener('change', renderStock));

  function renderStock() {
    if (!ed) return;
    const mode = stockMode();
    $('fStockTotal').hidden = mode !== 'total';
    const box = $('stockVariants');
    box.hidden = mode !== 'variants';
    if (mode !== 'variants') return;
    const keys = variantKeys(ed.sizes, ed.colours);
    if (!keys.length) { box.replaceChildren(el('p', { class: 'hint', text: 'Add sizes and/or colours above to set stock per variant. Without them, use “Total quantity”.' })); return; }
    box.replaceChildren(...keys.map((k) => el('label', {}, el('span', { text: k.replace('|', ' / ') }),
      el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', value: ed.stockVariants[k] ?? 0, 'aria-label': 'Stock for ' + k.replace('|', ' / '),
        oninput: (e) => { ed.stockVariants[k] = e.target.value; } }))));
  }

  /* ---- images ---- */
  function renderImages() {
    const box = $('images');
    box.replaceChildren(...ed.images.map((img, i) => el('div', { class: 'img' },
      el('div', { class: 'img__pic' },
        el('img', { src: img.preview || img.url, alt: 'Product image ' + (i + 1) }),
        i === 0 ? el('span', { class: 'img__tag', text: 'Main' }) : null,
        img.file ? el('span', { class: 'img__tag img__tag--new', text: 'New' }) : null),
      el('div', { class: 'img__bar' },
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move earlier', text: '←', disabled: i === 0, onclick: () => moveImage(i, -1) }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move later', text: '→', disabled: i === ed.images.length - 1, onclick: () => moveImage(i, 1) }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove image', text: '✕', onclick: () => removeImage(i) })))));
  }

  function moveImage(i, d) { const j = i + d; [ed.images[i], ed.images[j]] = [ed.images[j], ed.images[i]]; renderImages(); }
  function removeImage(i) {
    const [img] = ed.images.splice(i, 1);
    if (img.preview) URL.revokeObjectURL(img.preview);
    if (img.url && ed.original && (ed.original.images || []).includes(img.url)) ed.removed.push(img.url);
    renderImages();
  }

  $('fFiles').addEventListener('change', (e) => {
    const errs = [];
    [...e.target.files].forEach((f) => {
      if (ed.images.length >= MAX_IMAGES) { errs.push('Maximum ' + MAX_IMAGES + ' images.'); return; }
      if (!ALLOWED_TYPES.includes(f.type)) { errs.push(f.name + ': use JPG, PNG, WebP, AVIF or GIF.'); return; }
      if (f.size > 20 * 1024 * 1024) { errs.push(f.name + ': file is too large (max 20 MB).'); return; }
      ed.images.push({ file: f, preview: URL.createObjectURL(f) });
    });
    e.target.value = '';
    dlg.querySelector('[data-err=images]').textContent = [...new Set(errs)].join(' ');
    renderImages();
  });

  $('fUrlAdd').addEventListener('click', () => {
    const u = $('fUrl').value.trim();
    const err = dlg.querySelector('[data-err=images]');
    err.textContent = '';
    if (!u) return;
    if (!isHttpsUrl(u)) { err.textContent = 'Image URLs must start with https://'; return; }
    if (ed.images.length >= MAX_IMAGES) { err.textContent = 'Maximum ' + MAX_IMAGES + ' images.'; return; }
    ed.images.push({ url: u }); $('fUrl').value = ''; renderImages();
  });
  $('fUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('fUrlAdd').click(); } });

  // Downscale big photos (saves data and storage). Falls back to the original file on any problem.
  async function prepareImage(file) {
    if (file.type === 'image/gif' || file.type === 'image/avif' || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size <= 1.5 * 1024 * 1024) { bmp.close && bmp.close(); return file; }
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
      if (blob && blob.type === 'image/webp' && blob.size < file.size) return new File([blob], safeFileName(file.name).replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
    } catch (_) { /* use original */ }
    return file;
  }

  async function uniqueId(base) {
    let id = base && ID_PATTERN.test(base) ? base : 'product-' + Date.now().toString(36);
    for (let n = 2; n < 100; n++) {
      if (!(await F.getDoc(F.doc(db, 'products', id))).exists()) return id;
      id = (base || 'product') + '-' + n;
    }
    return (base || 'product') + '-' + Date.now().toString(36);
  }

  $('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ed) return;
    dlg.querySelectorAll('[data-err]').forEach((n) => { n.textContent = ''; });
    $('formError').textContent = '';
    commitPending();
    const { errors, data } = buildProductData({
      name: $('fName').value, price: $('fPrice').value, compareAt: $('fCompare').value, category: $('fCategory').value,
      sortOrder: $('fOrder').value, description: $('fDesc').value, sizes: ed.sizes, colours: ed.colours,
      stockMode: stockMode(), stockTotal: $('fStockTotal').value, stockVariants: ed.stockVariants,
      published: $('fPublished').checked, images: ed.images
    });
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([k, msg]) => { const n = dlg.querySelector('[data-err=' + k + ']'); if (n) n.textContent = msg; });
      $('formError').textContent = 'Please fix the highlighted fields.';
      return;
    }

    $('saveBtn').disabled = true;
    const uploaded = [];
    try {
      const id = ed.isNew ? await uniqueId(slugify(data.name)) : ed.id;
      const files = ed.images.filter((i) => i.file);
      let done = 0;
      const urls = new Map();
      if (files.length) {
        const { m, st } = await storage();
        for (const item of files) {
          $('saveStatus').textContent = 'Uploading image ' + (done + 1) + ' of ' + files.length + '…';
          const f = await prepareImage(item.file);
          if (f.size >= MAX_UPLOAD_BYTES) throw new Error(item.file.name + ' is still over 5 MB after optimising. Use a smaller image.');
          const path = 'products/' + id + '/' + Date.now().toString(36) + '-' + safeFileName(f.name);
          const r = m.ref(st, path);
          await new Promise((resolve, reject) => {
            const task = m.uploadBytesResumable(r, f, { contentType: f.type });
            task.on('state_changed', (s) => {
              $('saveStatus').textContent = 'Uploading image ' + (done + 1) + ' of ' + files.length + ' (' + Math.round(100 * s.bytesTransferred / s.totalBytes) + '%)…';
            }, reject, resolve);
          });
          uploaded.push(path);
          urls.set(item, await m.getDownloadURL(r));
          done++;
        }
      }
      data.images = ed.images.map((i) => (i.file ? urls.get(i) : i.url));
      $('saveStatus').textContent = 'Saving…';
      const ref = F.doc(db, 'products', id);
      if (ed.isNew) {
        if (data.sortOrder === undefined) data.sortOrder = Math.max(-1, ...products.map((p) => (typeof p.sortOrder === 'number' ? p.sortOrder : -1))) + 1;
        await F.setDoc(ref, { ...data, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
      } else {
        if (data.sortOrder === undefined) data.sortOrder = F.deleteField();
        await F.updateDoc(ref, { ...data, updatedAt: F.serverTimestamp() });
      }
      const cleanupFailed = await removeStorageUrls(ed.removed);
      toast(cleanupFailed ? 'Saved. Some replaced image files could not be removed from storage.' : 'Product saved', !!cleanupFailed);
      dlg.close();
    } catch (err) {
      console.error(err);
      if (uploaded.length) { // don't leave orphaned uploads behind if the save itself failed
        try { const { m, st } = await storage(); await Promise.all(uploaded.map((p) => m.deleteObject(m.ref(st, p)).catch(() => {}))); } catch (_) { /* ignore */ }
      }
      $('formError').textContent = friendly(err);
      $('saveStatus').textContent = '';
      $('saveBtn').disabled = false;
    }
  });

  function commitPending() {
    ['sizes', 'colours'].forEach((k) => { const i = chipInputs[k]; if (i.value.trim()) { i.value.split(',').forEach((v) => addChip(k, v)); i.value = ''; } });
  }

  /* ================= MIGRATION ================= */
  const seeds = () => (Array.isArray(window.ZALIELS_PRODUCTS) ? window.ZALIELS_PRODUCTS : []);
  let backedUp = false, busy = false;

  $('migInfo').textContent = seeds().length + ' product(s) found in products.js.';

  function downloadBackup() {
    const cfg = { ...(window.ZALIELS_CONFIG || {}) };
    Object.keys(cfg).forEach((k) => { if (typeof cfg[k] === 'function') delete cfg[k]; });
    const payload = { backedUpAt: new Date().toISOString(), source: 'products.js', config: cfg, products: seeds() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: 'zaliels-products-backup-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backedUp = true;
    toast('Backup downloaded');
  }
  $('migBackup').addEventListener('click', downloadBackup);

  async function refreshMigrationInfo() {
    try {
      const s = await F.getDoc(F.doc(db, 'meta', 'migration'));
      if (s.exists()) {
        const d = s.data(), when = d.ranAt && d.ranAt.toDate ? d.ranAt.toDate().toLocaleString() : 'unknown time';
        $('migLast').textContent = 'Last recorded run: ' + when + ' — created ' + d.created + ', skipped ' + d.skipped + ', failed ' + d.failed + '.';
      } else $('migLast').textContent = 'No migration has been recorded for this project yet.';
    } catch (err) { $('migLast').textContent = 'Could not read migration status: ' + friendly(err); }
  }

  async function migrate(dry) {
    if (busy) return;
    const list = seeds();
    if (!list.length) { toast('No products found in products.js.', true); return; }
    if (!dry && !backedUp && !(await askConfirm('Run without a backup?', 'You have not downloaded the backup in this session. Existing Firestore products are never overwritten, but a backup is still recommended.', 'Run anyway'))) return;
    busy = true;
    ['migBackup', 'migDry', 'migRun'].forEach((id) => { $(id).disabled = true; });
    const tbody = $('migTable').querySelector('tbody');
    tbody.replaceChildren(); $('migTable').hidden = false; $('migSummary').textContent = dry ? 'Dry run in progress…' : 'Migrating…';
    const counts = { created: 0, skipped: 0, failed: 0 };
    const seen = new Set();
    const row = (p, cls, text) => tbody.append(el('tr', {}, el('td', { text: String(p && p.id) }), el('td', { text: (p && p.name) || '' }), el('td', { class: cls, text })));

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        const bad = validateSeed(p);
        if (bad) { counts.failed++; row(p, 'res--fail', 'Failed: ' + bad); continue; }
        const id = String(p.id);
        if (seen.has(id)) { counts.skipped++; row(p, 'res--skip', 'Skipped: duplicate ID within products.js'); continue; }
        seen.add(id);
        const ref = F.doc(db, 'products', id);
        if (dry) {
          const exists = (await F.getDoc(ref)).exists();
          if (exists) { counts.skipped++; row(p, 'res--skip', 'Would skip (already in Firestore)'); } else { counts.created++; row(p, 'res--ok', 'Would create'); }
          continue;
        }
        const outcome = await F.runTransaction(db, async (tx) => {
          if ((await tx.get(ref)).exists()) return 'skipped';
          tx.set(ref, { ...seedToDoc(p, i), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
          return 'created';
        });
        if (outcome === 'skipped') { counts.skipped++; row(p, 'res--skip', 'Skipped (already in Firestore)'); continue; }
        if ((await F.getDoc(ref)).exists()) { counts.created++; row(p, 'res--ok', 'Created and verified'); }
        else { counts.failed++; row(p, 'res--fail', 'Failed: not found after writing'); }
      } catch (err) { counts.failed++; row(p, 'res--fail', 'Failed: ' + friendly(err)); }
    }

    if (dry) {
      $('migSummary').textContent = 'Dry run complete — nothing was written. Would create ' + counts.created + ', skip ' + counts.skipped + ', fail ' + counts.failed + '.';
    } else {
      $('migSummary').textContent = 'Migration finished: created ' + counts.created + ', skipped ' + counts.skipped + ', failed ' + counts.failed + '.' + (counts.failed ? ' Fix the failures and run again; completed items are skipped.' : '');
      try {
        await F.setDoc(F.doc(db, 'meta', 'migration'), { ranAt: F.serverTimestamp(), by: user.uid, source: 'products.js', total: list.length, ...counts });
      } catch (err) { toast('Migration ran, but the run could not be recorded: ' + friendly(err), true); }
      refreshMigrationInfo();
    }
    ['migBackup', 'migDry', 'migRun'].forEach((id) => { $(id).disabled = false; });
    busy = false;
  }
  $('migDry').addEventListener('click', () => migrate(true));
  $('migRun').addEventListener('click', () => migrate(false));
}
