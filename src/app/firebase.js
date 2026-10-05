/* Firebase backend for the hosted site (dist/web): Google sign-in + progress stored in Firestore.
   Loaded only in the Firebase build. It exposes window.StepwiseCloud, which app.js picks up:
     onUser(cb)        cb(user | null) now and on every sign-in / sign-out
     signIn()          Google sign-in (popup, or a full-page redirect where popups are blocked)
     signOut()
     progressRef(uid)  { get() -> { exists, data() }, set(progress) } for users/{uid} in Firestore
   The project's settings come from /__/firebase/init.json, which Firebase Hosting serves for this project. */
(function () {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

  function load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function config() {
    const r = await fetch('/__/firebase/init.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Firebase settings not found (HTTP ' + r.status + ')');
    const c = await r.json();
    // Serve the sign-in handler from the site's own domain so the redirect flow works in browsers that block
    // third-party storage.
    if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) c.authDomain = location.hostname;
    return c;
  }

  const listeners = [];
  let current = null;
  let known = false;

  function toUser(u) {
    return u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
  }

  const api = {
    onUser(cb) {
      listeners.push(cb);
      if (known) cb(current);
    },
    async signIn() {
      const auth = firebase.auth();
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(provider);
      } catch (e) {
        const code = e && e.code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await auth.signInWithRedirect(provider);
          return;
        }
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        throw e;
      }
    },
    signOut() {
      return firebase.auth().signOut();
    },
    progressRef(uid) {
      const doc = firebase.firestore().collection('users').doc(uid);
      return {
        async get() {
          const snap = await doc.get();
          const d = snap.exists ? snap.data() || {} : {};
          return { exists: !!d.progress, data: () => d.progress };
        },
        async set(progress) {
          await doc.set({ progress, updated: firebase.firestore.FieldValue.serverTimestamp() });
        },
      };
    },
  };

  (async function start() {
    try {
      const cfg = await config();
      await load(SDK + 'firebase-app-compat.js');
      await Promise.all([load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')]);
      firebase.initializeApp(cfg);
      firebase.auth().getRedirectResult().catch(() => { /* shown as signed out */ });
      firebase.auth().onAuthStateChanged((u) => {
        current = toUser(u);
        known = true;
        listeners.slice().forEach((cb) => cb(current));
      });
      window.StepwiseCloud = api;
      window.dispatchEvent(new Event('stepwise-cloud'));
    } catch (e) {
      // Without Firebase the course still works; progress stays in this browser.
      if (window.console) console.warn('Stepwise: sign-in and sync are unavailable here.', e);
    }
  })();
})();
