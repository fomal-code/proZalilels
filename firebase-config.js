/* ============================================
   ZALIELS — firebase-config.js
   FIREBASE WEB CONFIG (public by design — safe to commit).
   Security comes from firestore.rules / storage.rules, NOT from hiding these values.

   >>> REPLACE every 'REPLACE_ME' below with the values from
       Firebase console -> Project settings -> Your apps -> Web app -> SDK config.
   Until then the storefront keeps using the static catalogue in products.js
   and the admin dashboard will show a "Firebase not configured" notice.
   NEVER put a service-account key or any private key in this file.
   ============================================ */
(function () {
  var cfg = {
    apiKey: 'AIzaSyAFwOs_mhDtXwz0WMU9J6AlvBufOyPgiXQ',
    authDomain: 'zaliels.firebaseapp.com',
    projectId: 'zaliels',
    storageBucket: 'zaliels.firebasestorage.app',
    messagingSenderId: '296747279712',
    appId: '1:296747279712:web:dd13e6afc16a1ea1f4ea05'
  };
  var ok = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'].every(function (k) {
    return cfg[k] && String(cfg[k]).indexOf('REPLACE_ME') === -1;
  });
  window.ZALIELS_FIREBASE = { enabled: ok, config: cfg, sdkVersion: '10.14.1' };
})();
