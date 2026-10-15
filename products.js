/* ============================================
   ZALIELS — products.js
   Single source of truth for configuration and catalogue data.
   Loaded before script.js / shop.js.

   PRODUCT SCHEMA
   id          string, unique and stable (used by the cart)
   name        string
   price       number (whole currency units, e.g. 185000)
   compareAt   optional number > price; shows a Sale badge and struck-through old price
   images      array of image URLs (first = card image)
   description string ('' = none, section is hidden)
   category    string ('' = none; category filter appears once any product has one)
   sizes       array, e.g. ['S','M','L']   ([] = no size choice)
   colours     array, e.g. ['Black','Ivory'] ([] = no colour choice)
   stock       null  = unknown (nothing is blocked, nothing is shown)
               number = total units available
               object = units per variant, keyed 'Size|Colour', 'Size' or 'Colour'
                        (list every variant; e.g. { 'M|Black': 3, 'L|Black': 0 })

   Only real data has been entered below; missing details are left empty on purpose.

   FIREBASE: once firebase-config.js is filled in, the storefront loads products from Firestore
   (see catalogue.js) and this list is only (a) the one-time migration source used by /admin/ and
   (b) the fallback while Firebase is not configured. After migrating, edit products in /admin/.

   (old note) FUTURE BACKEND: fetch your products and call
     Zaliels.setProducts(arrayOfProducts)
   To replace WhatsApp checkout, set ZALIELS_CONFIG.onCheckout = function (order) {...}
   ============================================ */

window.ZALIELS_CONFIG = {
  brand: 'Zaliels',
  whatsappNumber: '2349138947809', // international format, no +
  currencyCode: 'NGN',
  currencySymbol: '₦',
  pageSize: 6,                     // products per page
  storageKey: 'zaliels_cart_v1',
  onCheckout: null,
  // Optional — leave '' until you have real values (nothing is shown/added when empty)
  siteUrl: '',        // e.g. 'https://www.yourdomain.com/'  -> adds canonical + og:url
  ogImage: '',        // absolute image URL for link previews
  deliveryNote: '',   // e.g. your real delivery/returns wording; shown in cart + quick view
  social: { instagram: '', pinterest: '' } // full profile URLs; WhatsApp link is built from whatsappNumber
};

window.ZALIELS_PRODUCTS = [
  {
    id: 'velour-drape-coat',
    name: 'Velour Drape Coat',
    price: 185000,
    images: ['https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  },
  {
    id: 'silk-column-dress',
    name: 'Silk Column Dress',
    price: 142000,
    images: ['https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  },
  {
    id: 'wool-tailored-blazer',
    name: 'Wool Tailored Blazer',
    price: 210000,
    images: ['https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  },
  {
    id: 'linen-wide-leg-trouser',
    name: 'Linen Wide-Leg Trouser',
    price: 98000,
    images: ['https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  },
  {
    id: 'cashmere-minimal-sweater',
    name: 'Cashmere Minimal Sweater',
    price: 125000,
    images: ['https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  },
  {
    id: 'structured-midi-skirt',
    name: 'Structured Midi Skirt',
    price: 88000,
    images: ['https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&q=80'],
    description: '', category: '', sizes: [], colours: [], stock: null
  }
];
