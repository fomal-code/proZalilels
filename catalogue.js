
const FB = window.ZALIELS_FIREBASE;
const Z = window.Zaliels;

if (FB && FB.enabled && Z && Z.setProducts) {
  const base = 'https://www.gstatic.com/firebasejs/' + FB.sdkVersion + '/';

  const toProduct = (snap) => {
    const d = snap.data();
    return {
      id: snap.id,
      name: d.name,
      price: d.price,
      compareAt: d.compareAt || 0,
      images: Array.isArray(d.images) ? d.images : [],
      description: d.description || '',
      category: d.category || '',
      sizes: Array.isArray(d.sizes) ? d.sizes : [],
      colours: Array.isArray(d.colours) ? d.colours : [],
      stock: d.stock === undefined ? null : d.stock,
      _order: typeof d.sortOrder === 'number' ? d.sortOrder : Number.MAX_SAFE_INTEGER
    };
  };

  let db, fs;

  const load = async () => {
    Z.setLoading();
    try {
      if (!db) {
        const [{ initializeApp }, firestore] = await Promise.all([
          import(base + 'firebase-app.js'),
          import(base + 'firebase-firestore.js')
        ]);
        fs = firestore;
        db = fs.getFirestore(initializeApp(FB.config));
      }
      // Equality filter only (no composite index needed); matches the security rule for public reads.
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'products'), fs.where('published', '==', true)));
      const list = snap.docs.map(toProduct).sort((a, b) => a._order - b._order || String(a.name).localeCompare(String(b.name)));
      Z.setProducts(list);
    } catch (err) {
      console.error('[Zaliels] Could not load products', err);
      Z.setError("We couldn't load the collection right now. Please check your connection and try again.", load);
    }
  };

  load();
}
