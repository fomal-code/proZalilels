
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
