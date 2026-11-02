/* PBB Corretajes Firebase backend adapter v14 */
(() => {
  'use strict';

  const ADMIN_EMAIL = 'paulina.barriga@unne.cl';
  const FIREBASE_SDK_VERSION = '8.10.1';
  const DEFAULT_INFO = {
    tel: '+56 9 5352 5294',
    email: ADMIN_EMAIL,
    dir: 'Los Ángeles, Región del Biobío',
    horario: 'Lun–Vie 9:00–18:30 · Sáb 10:00–13:00'
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isoNow = () => new Date().toISOString();
  const uid = prefix => `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const safeJson = value => JSON.parse(JSON.stringify(value));
  function createSafeStore() {
    try {
      const store = window.localStorage;
      const probe = '__pbb_backend_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    } catch (_) {
      const memory = Object.create(null);
      return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
        setItem(key, value) { memory[key] = String(value); },
        removeItem(key) { delete memory[key]; }
      };
    }
  }
  const backendStore = createSafeStore();

  function loadScript(src, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src && script.src.endsWith(src));
      if (existing?.dataset.loaded === '1') return resolve();
      const script = existing || document.createElement('script');
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Tiempo de espera agotado al cargar ${src}`));
      }, timeoutMs);
      script.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`No se pudo cargar ${src}`));
      };
      if (!existing) {
        script.src = src;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
  }

  function formatError(error) {
    const code = String(error?.code || '');
    if (code.includes('auth/invalid-login-credentials') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) {
      return new Error('Correo o contraseña incorrectos.');
    }
    if (code.includes('auth/too-many-requests')) return new Error('Demasiados intentos. Espere unos minutos y vuelva a intentar.');
    if (code.includes('permission-denied')) return new Error('Firebase rechazó la operación por reglas de seguridad. Revise que el usuario administrador y las reglas estén publicados.');
    if (code.includes('failed-precondition')) return new Error('Firestore todavía no está configurado o falta un índice.');
    if (code.includes('unavailable')) return new Error('Firebase no está disponible temporalmente. Revise su conexión.');
    return new Error(error?.message || String(error || 'Error inesperado'));
  }

  function tsToIso(value) {
    try {
      if (value?.toDate) return value.toDate().toISOString();
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'string') return value;
    } catch (_) {}
    return '';
  }

  function publicProperty(id, data) {
    const cover = String(data.cover || '');
    return {
      id,
      titulo: String(data.titulo || ''),
      tipo: String(data.tipo || 'Casa'),
      disp: String(data.disp || 'Venta'),
      precio: String(data.precio || ''),
      dorm: String(data.dorm || ''),
      banos: String(data.banos || ''),
      m2: String(data.m2 || ''),
      sector: String(data.sector || ''),
      descripcion: String(data.descripcion || ''),
      fotos: cover ? [{ fileId: String(data.coverImageId || ''), url: cover }] : [],
      imageCount: Number(data.imageCount || 0),
      updated_at: tsToIso(data.updatedAt)
    };
  }

  class FirebaseBackend {
    constructor() {
      this.readyPromise = null;
      this.db = null;
      this.auth = null;
      this.projectId = '';
    }

    async ready() {
      if (this.readyPromise) return this.readyPromise;
      this.readyPromise = (async () => {
        try {
          if (!window.firebase) {
            await loadScript(`/__/firebase/${FIREBASE_SDK_VERSION}/firebase-app.js`);
            await loadScript(`/__/firebase/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
            await loadScript(`/__/firebase/${FIREBASE_SDK_VERSION}/firebase-firestore.js`);
            await loadScript('/__/firebase/init.js');
          }
          if (!window.firebase) throw new Error('Firebase SDK no fue cargado por Firebase Hosting.');
          if (!firebase.apps?.length) {
            const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('No se pudo obtener la configuración automática de Firebase Hosting.');
            firebase.initializeApp(await response.json());
          }
          const app = firebase.app();
          this.projectId = app.options.projectId || '';
          this.db = firebase.firestore();
          this.auth = firebase.auth();
          try { await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (_) {}
          try { await this.db.enablePersistence({ synchronizeTabs: true }); } catch (_) {}
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 2500);
            const stop = this.auth.onAuthStateChanged(() => {
              clearTimeout(timer);
              stop();
              resolve();
            });
          });
          return this;
        } catch (error) {
          this.readyPromise = null;
          throw formatError(error);
        }
      })();
      return this.readyPromise;
    }

    async assertAdmin() {
      await this.ready();
      const user = this.auth.currentUser;
      if (!user) throw new Error('La sesión de administración venció. Ingrese nuevamente.');
      if (normalizeEmail(user.email) !== normalizeEmail(ADMIN_EMAIL)) {
        await this.auth.signOut().catch(() => {});
        throw new Error('Esta cuenta no está autorizada para administrar el sitio.');
      }
      return user;
    }

    async call(name, ...args) {
      await this.ready();
      if (typeof this[name] !== 'function' || name === 'call' || name === 'ready') throw new Error(`Operación Firebase no disponible: ${name}`);
      try { return await this[name](...args); }
      catch (error) { throw formatError(error); }
    }

    async getPublicData() {
      // La página pública ya muestra Instagram en lugar del catálogo de propiedades.
      // Solo leemos la configuración de contacto para reducir lecturas y dependencias.
      const siteSnap = await this.db.doc('settings/site').get();
      const info = { ...DEFAULT_INFO, ...(siteSnap.exists ? siteSnap.data() : {}) };
      return { ok: true, info, properties: [], generatedAt: isoNow(), version: '14.2.0-instagram-feed' };
    }

    async loginAdmin(password) {
      if (!password) throw new Error('Ingrese la contraseña.');
      const credential = await this.auth.signInWithEmailAndPassword(ADMIN_EMAIL, password);
      if (normalizeEmail(credential.user?.email) !== normalizeEmail(ADMIN_EMAIL)) {
        await this.auth.signOut();
        throw new Error('Esta cuenta no está autorizada.');
      }
      return { ok: true, token: credential.user.uid, email: credential.user.email };
    }

    async getImages(propertyId) {
      const snap = await this.db.collection('properties').doc(propertyId).collection('images').orderBy('order', 'asc').get();
      return snap.docs.map(doc => {
        const data = doc.data();
        return {
          fileId: doc.id,
          url: String(data.dataUrl || ''),
          name: String(data.name || ''),
          isNew: false
        };
      });
    }

    async getPropertyImages(_token, propertyId) {
      await this.assertAdmin();
      return { photos: await this.getImages(propertyId) };
    }

    async getAdminData() {
      await this.assertAdmin();
      const [siteSnap, propsSnap, crmSnap] = await Promise.all([
        this.db.doc('settings/site').get(),
        this.db.collection('properties').get(),
        this.db.collection('crm').orderBy('createdAt', 'desc').limit(100).get()
      ]);
      const info = { ...DEFAULT_INFO, ...(siteSnap.exists ? siteSnap.data() : {}) };
      const active = [];
      const deleted = [];
      for (const doc of propsSnap.docs) {
        const data = doc.data();
        const item = publicProperty(doc.id, data);
        item.deleted = Boolean(data.deleted);
        if (item.deleted) {
          deleted.push(item);
        } else {
          item.fotos = await this.getImages(doc.id);
          active.push(item);
        }
      }
      active.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      deleted.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      const crm = crmSnap.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, tipo: data.type || '', data: data.data || {}, created_at: tsToIso(data.createdAt) };
      });
      const base = `https://console.firebase.google.com/project/${this.projectId}`;
      return {
        info,
        properties: active,
        deletedProperties: deleted,
        crm,
        system: {
          version: '14.0.0 Firebase',
          spreadsheetUrl: `${base}/firestore/databases/-default-/data/~2Fproperties`,
          imageFolderUrl: `${base}/firestore/databases/-default-/data/~2Fproperties`,
          currentBackupUrl: `${base}/firestore/databases/-default-/data/~2Fbackups`,
          backupFolderUrl: `${base}/hosting/sites`
        }
      };
    }

    async createBackup(reason) {
      await this.assertAdmin();
      const [siteSnap, propsSnap] = await Promise.all([
        this.db.doc('settings/site').get(),
        this.db.collection('properties').get()
      ]);
      const properties = propsSnap.docs.map(doc => {
        const data = doc.data();
        const copy = {
          id: doc.id,
          titulo: data.titulo || '', tipo: data.tipo || '', disp: data.disp || '', precio: data.precio || '',
          dorm: data.dorm || '', banos: data.banos || '', m2: data.m2 || '', sector: data.sector || '',
          descripcion: data.descripcion || '', deleted: Boolean(data.deleted), imageCount: Number(data.imageCount || 0),
          coverImageId: data.coverImageId || '', createdAt: tsToIso(data.createdAt), updatedAt: tsToIso(data.updatedAt), deletedAt: tsToIso(data.deletedAt)
        };
        return copy;
      });
      await this.db.collection('backups').add({
        reason: String(reason || 'manual'),
        settings: siteSnap.exists ? siteSnap.data() : DEFAULT_INFO,
        properties,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      const old = await this.db.collection('backups').orderBy('createdAt', 'desc').limit(30).get();
      if (old.size > 20) {
        const batch = this.db.batch();
        old.docs.slice(20).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    async saveSiteInfo(_token, nextInfo) {
      await this.assertAdmin();
      await this.createBackup('antes de modificar datos de contacto');
      const clean = {
        tel: String(nextInfo?.tel || '').slice(0, 80),
        email: String(nextInfo?.email || '').slice(0, 160),
        dir: String(nextInfo?.dir || '').slice(0, 240),
        horario: String(nextInfo?.horario || '').slice(0, 160),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await this.db.doc('settings/site').set(clean, { merge: true });
      return { ok: true, info: clean };
    }

    async uploadPropertyImage(_token, image) {
      await this.assertAdmin();
      const base64 = String(image?.base64 || '');
      if (!base64) throw new Error('La imagen está vacía.');
      if (base64.length > 760000) throw new Error('La imagen optimizada supera el límite de Firestore.');
      return {
        photo: {
          fileId: uid('tmp'),
          url: `data:${image.mimeType || 'image/jpeg'};base64,${base64}`,
          name: String(image.name || 'foto.jpg').slice(0, 120),
          isNew: true
        }
      };
    }

    async deletePropertyImage() {
      await this.assertAdmin();
      return { ok: true };
    }

    async saveProperty(_token, input) {
      await this.assertAdmin();
      if (!String(input?.titulo || '').trim()) throw new Error('El título es obligatorio.');
      const photos = Array.isArray(input.fotos) ? input.fotos.slice(0, 10) : [];
      const removed = Array.isArray(input.removedPhotoIds) ? input.removedPhotoIds : [];
      await this.createBackup('antes de guardar propiedad');

      const ref = input.id ? this.db.collection('properties').doc(String(input.id)) : this.db.collection('properties').doc();
      const current = await ref.get();
      const batch = this.db.batch();
      const storedPhotos = [];

      photos.forEach((photo, index) => {
        const existingId = String(photo.fileId || '');
        const imageId = existingId && !existingId.startsWith('tmp-') ? existingId : ref.collection('images').doc().id;
        const url = String(photo.url || '');
        if (!url.startsWith('data:image/')) throw new Error(`La foto ${index + 1} no tiene un formato válido.`);
        if (url.length > 790000) throw new Error(`La foto ${index + 1} supera el tamaño permitido.`);
        const imageRef = ref.collection('images').doc(imageId);
        batch.set(imageRef, {
          dataUrl: url,
          name: String(photo.name || `foto-${index + 1}.jpg`).slice(0, 120),
          order: index,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        storedPhotos.push({ fileId: imageId, url });
      });

      removed.filter(Boolean).forEach(imageId => batch.delete(ref.collection('images').doc(String(imageId))));
      const first = storedPhotos[0] || null;
      const createdAt = current.exists && current.data().createdAt ? current.data().createdAt : firebase.firestore.FieldValue.serverTimestamp();
      batch.set(ref, {
        titulo: String(input.titulo || '').trim().slice(0, 180),
        tipo: String(input.tipo || 'Casa').slice(0, 80),
        disp: String(input.disp || 'Venta').slice(0, 80),
        precio: String(input.precio || '').slice(0, 80),
        dorm: String(input.dorm || '').slice(0, 30),
        banos: String(input.banos || '').slice(0, 30),
        m2: String(input.m2 || '').slice(0, 40),
        sector: String(input.sector || '').slice(0, 180),
        descripcion: String(input.descripcion || '').slice(0, 3000),
        cover: first?.url || '',
        coverImageId: first?.fileId || '',
        imageCount: storedPhotos.length,
        deleted: false,
        deletedAt: null,
        createdAt,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await batch.commit();
      return { ok: true, id: ref.id };
    }

    async deleteProperty(_token, id) {
      await this.assertAdmin();
      await this.createBackup('antes de mover propiedad a papelera');
      await this.db.collection('properties').doc(String(id)).set({
        deleted: true,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { ok: true };
    }

    async restoreDeletedProperty(_token, id) {
      await this.assertAdmin();
      await this.createBackup('antes de restaurar propiedad');
      await this.db.collection('properties').doc(String(id)).set({
        deleted: false,
        deletedAt: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { ok: true };
    }

    async recordCrmEvent(type, data) {
      const cleanType = String(type || '').slice(0, 50);
      const cleanData = safeJson(data || {});
      const text = JSON.stringify(cleanData);
      if (text.length > 9000) throw new Error('El mensaje es demasiado extenso.');
      await this.db.collection('crm').add({
        type: cleanType,
        data: cleanData,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true };
    }

    async restorePreviousBackup() {
      await this.assertAdmin();
      const snap = await this.db.collection('backups').orderBy('createdAt', 'desc').limit(1).get();
      if (snap.empty) throw new Error('Todavía no existe un respaldo anterior.');
      const backup = snap.docs[0].data();
      const currentSnap = await this.db.collection('properties').get();
      const currentById = new Map(currentSnap.docs.map(doc => [doc.id, doc.data()]));
      const backupIds = new Set((backup.properties || []).map(item => item.id));
      const batch = this.db.batch();
      batch.set(this.db.doc('settings/site'), backup.settings || DEFAULT_INFO, { merge: true });
      for (const item of backup.properties || []) {
        const current = currentById.get(item.id) || {};
        batch.set(this.db.collection('properties').doc(item.id), {
          titulo: item.titulo || '', tipo: item.tipo || '', disp: item.disp || '', precio: item.precio || '',
          dorm: item.dorm || '', banos: item.banos || '', m2: item.m2 || '', sector: item.sector || '',
          descripcion: item.descripcion || '', deleted: Boolean(item.deleted), imageCount: Number(item.imageCount || current.imageCount || 0),
          cover: current.cover || '', coverImageId: current.coverImageId || item.coverImageId || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      currentSnap.docs.filter(doc => !backupIds.has(doc.id)).forEach(doc => batch.set(doc.ref, {
        deleted: true,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }));
      await batch.commit();
      return { ok: true };
    }

    async changeAdminPassword(_token, currentPassword, nextPassword) {
      const user = await this.assertAdmin();
      if (String(nextPassword || '').length < 10) throw new Error('La nueva contraseña debe tener al menos 10 caracteres.');
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ''));
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(String(nextPassword));
      await this.auth.signOut();
      return { ok: true };
    }
  }

  class MockBackend {
    constructor() {
      this.prefix = 'pbb_firebase_mock_v14_';
      this.admin = false;
      if (!backendStore.getItem(this.prefix + 'info')) backendStore.setItem(this.prefix + 'info', JSON.stringify(DEFAULT_INFO));
      if (!backendStore.getItem(this.prefix + 'properties')) backendStore.setItem(this.prefix + 'properties', '[]');
      if (!backendStore.getItem(this.prefix + 'crm')) backendStore.setItem(this.prefix + 'crm', '[]');
      if (!backendStore.getItem(this.prefix + 'backups')) backendStore.setItem(this.prefix + 'backups', '[]');
    }
    async ready() { return this; }
    read(key, fallback) { try { return JSON.parse(backendStore.getItem(this.prefix + key) || JSON.stringify(fallback)); } catch (_) { return fallback; } }
    write(key, value) { backendStore.setItem(this.prefix + key, JSON.stringify(value)); }
    assertAdmin() { if (!this.admin) throw new Error('La sesión de administración venció. Ingrese nuevamente.'); }
    async call(name, ...args) { await sleep(30); if (typeof this[name] !== 'function') throw new Error(`Operación mock no disponible: ${name}`); return this[name](...args); }
    getPublicData() { return { ok:true, info:this.read('info', DEFAULT_INFO), properties:[], generatedAt:isoNow(), version:'14.2.0-instagram-feed-mock' }; }
    loginAdmin(password) { if (password !== 'PBB2026!') throw new Error('Contraseña incorrecta. En modo prueba use PBB2026!'); this.admin=true; return {ok:true,token:'mock-admin'}; }
    createBackup(reason) { const b=this.read('backups',[]); b.unshift({reason,settings:this.read('info',DEFAULT_INFO),properties:this.read('properties',[]),createdAt:isoNow()}); this.write('backups',b.slice(0,20)); }
    getAdminData() { this.assertAdmin(); const all=this.read('properties',[]); return {info:this.read('info',DEFAULT_INFO),properties:all.filter(p=>!p.deleted),deletedProperties:all.filter(p=>p.deleted),crm:this.read('crm',[]),system:{version:'14.2.0 Mock + Instagram',spreadsheetUrl:'#',imageFolderUrl:'#',currentBackupUrl:'#',backupFolderUrl:'#'}}; }
    saveSiteInfo(_t,next){this.assertAdmin();this.createBackup('contacto');this.write('info',{...DEFAULT_INFO,...next});return {ok:true,info:{...DEFAULT_INFO,...next}};}
    uploadPropertyImage(_t,image){this.assertAdmin();return {photo:{fileId:uid('tmp'),url:`data:${image.mimeType||'image/jpeg'};base64,${image.base64}`,name:image.name||'foto.jpg',isNew:true}};}
    deletePropertyImage(){this.assertAdmin();return {ok:true};}
    saveProperty(_t,input){this.assertAdmin();this.createBackup('propiedad');const all=this.read('properties',[]),id=input.id||uid('prop'),idx=all.findIndex(p=>p.id===id);const item={...input,id,deleted:false,updated_at:isoNow(),fotos:(input.fotos||[]).map((p,i)=>({...p,fileId:String(p.fileId||uid('img')),isNew:false})),imageCount:(input.fotos||[]).length};delete item.removedPhotoIds;if(idx>=0)all[idx]=item;else all.unshift(item);this.write('properties',all);return {ok:true,id};}
    deleteProperty(_t,id){this.assertAdmin();this.createBackup('eliminar');const all=this.read('properties',[]).map(p=>p.id===id?{...p,deleted:true,updated_at:isoNow()}:p);this.write('properties',all);return {ok:true};}
    restoreDeletedProperty(_t,id){this.assertAdmin();this.createBackup('restaurar');const all=this.read('properties',[]).map(p=>p.id===id?{...p,deleted:false,updated_at:isoNow()}:p);this.write('properties',all);return {ok:true};}
    recordCrmEvent(type,data){const rows=this.read('crm',[]);rows.unshift({id:uid('crm'),tipo:type,data,created_at:isoNow()});this.write('crm',rows.slice(0,200));return {ok:true};}
    restorePreviousBackup(){this.assertAdmin();const b=this.read('backups',[])[0];if(!b)throw new Error('No hay respaldo anterior.');this.write('info',b.settings);this.write('properties',b.properties);return {ok:true};}
    changeAdminPassword(){this.assertAdmin();this.admin=false;return {ok:true};}
    getPropertyImages(_t,id){this.assertAdmin();const p=this.read('properties',[]).find(x=>x.id===id);return {photos:p?.fotos||[]};}
  }

  const params = new URLSearchParams(location.search);
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
  const useMock = window.__PBB_FORCE_MOCK === true || params.get('mock') === '1' || (isLocal && params.get('firebase') !== '1');
  const implementation = useMock ? new MockBackend() : new FirebaseBackend();

  window.PBB_BACKEND = {
    mode: useMock ? 'mock' : 'firebase',
    adminEmail: ADMIN_EMAIL,
    call(name, ...args) { return implementation.call(name, ...args); },
    ready() { return implementation.ready(); }
  };
})();


'use strict';

const C = Object.freeze({
  cacheKey: 'pbb_public_cache_v14',
  sessionKey: 'pbb_admin_token_v14',
  maxPhotos: 10,
  maxUploadBytes: 380000
});
const DEFAULT_INFO = Object.freeze({
  tel: '+56 9 5352 5294',
  email: 'paulina.barriga@unne.cl',
  dir: 'Los Ángeles, Región del Biobío',
  horario: 'Lun–Vie 9:00–18:30 · Sáb 10:00–13:00'
});

function memoryStorage() {
  const values = Object.create(null);
  return { getItem:key => Object.prototype.hasOwnProperty.call(values,key) ? values[key] : null, setItem:(key,value) => { values[key]=String(value); }, removeItem:key => { delete values[key]; }, clear:() => Object.keys(values).forEach(key => delete values[key]) };
}
function safeStorage(name) {
  try {
    const store = window[name], probe = '__pbb_storage_test__';
    store.setItem(probe,'1'); store.removeItem(probe);
    return store;
  } catch (_) { return memoryStorage(); }
}
const localStore = safeStorage('localStorage');
const sessionStore = safeStorage('sessionStorage');

let props = [], deletedProps = [], visits = [], crmRows = [], editFotos = [], slideIdx = {};
let info = { ...DEFAULT_INFO }, adminSystem = {};
let adminToken = sessionStore.getItem(C.sessionKey) || '';
let originalPhotoIds = new Set(), newPhotoIds = new Set(), removedExistingPhotoIds = new Set();
let chatOpen = false, chatStarted = false, awaitName = false, awaitContact = false, cName = '', chatHistory = [], menuOpen = false;
let lastPublicSyncAt = 0, publicLoadPromise = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function gas(name, ...args) {
  if (!window.PBB_BACKEND) return Promise.reject(new Error('El adaptador Firebase no se cargó.'));
  return window.PBB_BACKEND.call(name, ...args);
}
function setSyncStatus(text, mode = '') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = text;
  el.className = `sync-status ${mode}`;
}
function getCachedData() {
  try {
    const data = JSON.parse(localStore.getItem(C.cacheKey) || 'null');
    return data && Array.isArray(data.properties) ? data : null;
  } catch (_) { return null; }
}
function saveCache(data) {
  try {
    localStore.setItem(C.cacheKey, JSON.stringify({
      info: data.info || DEFAULT_INFO,
      properties: data.properties || [],
      generatedAt: data.generatedAt || new Date().toISOString(),
      version: data.version || ''
    }));
  } catch (_) {}
}
function hydrateFromCache() {
  const cached = getCachedData();
  if (!cached) return false;
  info = { ...DEFAULT_INFO, ...(cached.info || {}) };
  props = cached.properties || [];
  renderContacto(); renderProps();
  const stamp = cached.generatedAt ? new Date(cached.generatedAt).toLocaleString('es-CL') : '';
  setSyncStatus(`Mostrando copia local${stamp ? ' del '+stamp : ''} mientras se actualiza…`, 'warn');
  return true;
}
async function loadPublicData({ silent = false, force = false } = {}) {
  if (publicLoadPromise && !force) return publicLoadPromise;
  if (!force && silent && Date.now() - lastPublicSyncAt < 15000) return null;
  if (!silent) setSyncStatus('Conectando con Firebase…', 'loading');
  publicLoadPromise = (async () => {
    try {
      const data = await gas('getPublicData');
      info = { ...DEFAULT_INFO, ...(data.info || {}) };
      props = Array.isArray(data.properties) ? data.properties : [];
      lastPublicSyncAt = Date.now();
      saveCache(data);
      renderContacto(); renderProps(); renderAdminProps();
      let when = 'ahora';
      try { if (data.generatedAt) when = new Date(data.generatedAt).toLocaleString('es-CL', {dateStyle:'short', timeStyle:'short'}); } catch (_) {}
      setSyncStatus(`Actualizado desde Firebase: ${when}`, 'ok');
      return data;
    } catch (error) {
      const cached = getCachedData();
      if (cached) {
        info = { ...DEFAULT_INFO, ...(cached.info || {}) };
        props = cached.properties || [];
        renderContacto(); renderProps(); renderAdminProps();
        setSyncStatus('Sin conexión: se muestra la última copia disponible. Al recuperar conexión se actualizará automáticamente.', 'warn');
        return cached;
      }
      const grid = document.getElementById('props-grid');
      if (grid) grid.innerHTML = `<div class="no-props">⚠️ No fue posible cargar las propiedades.<br><small>${esc(error.message)}</small></div>`;
      setSyncStatus('La página abrió correctamente, pero la base de datos aún no está disponible.', 'error');
      return { ok:false, error:error.message };
    } finally { publicLoadPromise = null; }
  })();
  return publicLoadPromise;
}
function refreshPublicIfNeeded(force = false) {
  if (document.visibilityState === 'hidden') return;
  if (force || Date.now() - lastPublicSyncAt > 45000) loadPublicData({silent:true, force}).catch(()=>{});
}

function renderContacto() {
  const values = {'info-tel': info.tel, 'info-email': info.email, 'info-dir': info.dir, 'info-horario': info.horario};
  Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; });
  const wa = document.getElementById('wa-btn');
  if (wa) wa.href = `https://wa.me/${String(info.tel || '').replace(/\D/g,'')}?text=Hola%2C%20me%20interesa%20consultar%20sobre%20sus%20servicios`;
}
function photoUrl(photo) { return typeof photo === 'string' ? photo : (photo?.url || ''); }
function photoId(photo) { return typeof photo === 'object' && photo ? String(photo.fileId || '') : ''; }
function renderProps() {
  const grid = document.getElementById('props-grid');
  if (!grid) return;
  if (!props.length) { grid.innerHTML = '<div class="no-props">No hay propiedades publicadas aún.</div>'; return; }
  grid.innerHTML = props.map((p, i) => {
    const photos = Array.isArray(p.fotos) ? p.fotos.filter(x => photoUrl(x)) : [];
    const slides = photos.length
      ? photos.map((x, j) => `<img class="prop-slide" src="${esc(photoUrl(x))}" alt="${esc(p.titulo)} — foto ${j+1}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')
      : '<div class="prop-slide-ph"><svg width="60" height="60" viewBox="0 0 80 80" fill="none" style="opacity:0.15"><path d="M10 35L40 10L70 35V70H50V50H30V70H10V35Z" fill="white"/></svg></div>';
    const multi = photos.length > 1;
    return `<article class="prop-card" data-prop-index="${i}" tabindex="0" aria-label="Ver ${esc(p.titulo)}">
      <div class="prop-gallery"><div class="prop-gallery-inner" id="gi${i}">${slides}</div>
      ${multi ? `<button type="button" aria-label="Foto anterior" class="gal-btn prev" onclick="event.stopPropagation();chSlide(${i},-1)">‹</button><button type="button" aria-label="Foto siguiente" class="gal-btn next" onclick="event.stopPropagation();chSlide(${i},1)">›</button><div class="gal-counter" id="gc${i}">1/${photos.length}</div><div class="gal-dots" id="gd${i}">${photos.map((_,j)=>`<button type="button" aria-label="Ir a foto ${j+1}" class="gal-dot${j===0?' on':''}" onclick="event.stopPropagation();goSlide(${i},${j})"></button>`).join('')}</div>` : ''}
      <span class="prop-badge">${esc(p.disp)}</span></div>
      <div class="prop-info"><p class="prop-type">${esc(p.tipo)}${p.sector ? ' · '+esc(p.sector) : ''}</p><h3>${esc(p.titulo)}</h3>
      <div class="prop-meta">${p.dorm?`<span>🛏 ${esc(p.dorm)} dorm</span>`:''}${p.banos?`<span>🚿 ${esc(p.banos)} baños</span>`:''}${p.m2?`<span>📐 ${esc(p.m2)} m²</span>`:''}</div>
      ${p.descripcion?`<p class="prop-desc-txt">${esc(p.descripcion)}</p>`:''}<div class="prop-price">${esc(p.precio)}</div></div></article>`;
  }).join('');
  grid.querySelectorAll('.prop-card').forEach(card => {
    const index = Number(card.dataset.propIndex);
    const open = () => { const p = props[index]; if (p) trackVisit(p.id, p.titulo); };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    attachSwipe(card.querySelector('.prop-gallery'), index);
  });
}
function attachSwipe(el, index) {
  const count = props[index]?.fotos?.length || 0;
  if (!el || count < 2) return;
  let x=0,y=0;
  el.addEventListener('touchstart', e => {x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;}, {passive:true});
  el.addEventListener('touchend', e => {const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))chSlide(index,dx<0?1:-1);}, {passive:true});
}
function chSlide(i,d) {
  const count = props[i]?.fotos?.filter(x=>photoUrl(x)).length || 0;
  if (count < 2) return;
  slideIdx[i] = (((slideIdx[i]||0)+d)%count+count)%count; updateGallery(i,count);
}
function goSlide(i,j) { slideIdx[i]=j; updateGallery(i,props[i]?.fotos?.length||0); }
function updateGallery(i,count) {
  const idx=slideIdx[i]||0, inner=document.getElementById('gi'+i), dots=document.getElementById('gd'+i), counter=document.getElementById('gc'+i);
  if(inner)inner.style.transform=`translateX(-${idx*100}%)`;
  if(dots)dots.querySelectorAll('.gal-dot').forEach((d,j)=>d.classList.toggle('on',j===idx));
  if(counter)counter.textContent=`${idx+1}/${count}`;
}
async function trackVisit(id,name) {
  const key='pbb_visit_'+id,last=Number(sessionStore.getItem(key)||0);
  if(Date.now()-last<1800000)return;
  sessionStore.setItem(key,String(Date.now()));
  const data={propiedad:name,propiedad_id:id,origen:document.referrer||'Directo',pagina:location.href};
  visits.unshift({prop:name,id,hora:new Date().toLocaleString('es-CL'),ts:Date.now(),ref:data.origen}); renderStats();
  gas('recordCrmEvent','VISITA_PROPIEDAD',data).catch(()=>{});
}
function saveCrmEvent(type,data) { return gas('recordCrmEvent',type,{fecha_local:new Date().toLocaleString('es-CL'),pagina:location.href,...data}); }
async function enviarForm() {
  const n=document.getElementById('cf-n').value.trim(),e=document.getElementById('cf-e').value.trim(),t=document.getElementById('cf-t').value.trim(),c=document.getElementById('cf-c').value,m=document.getElementById('cf-m').value.trim();
  if(!n||!e)return alert('Por favor complete su nombre y correo.');
  if(!/^\S+@\S+\.\S+$/.test(e))return alert('Ingrese un correo válido.');
  const btn=document.getElementById('fsub-btn');btn.disabled=true;btn.textContent='Enviando…';document.getElementById('form-err').style.display='none';
  try{await saveCrmEvent('CONTACTO_WEB',{_subject:`📩 PBB — consulta web de ${n}`,nombre:n,email:e,telefono:t,consulta:c,mensaje:m});document.getElementById('form-wrap').style.display='none';document.getElementById('ok-email').textContent=e;document.getElementById('form-ok').style.display='block';}
  catch(error){btn.disabled=false;btn.textContent='Enviar mensaje →';const x=document.getElementById('form-err');x.textContent=`❌ No se pudo enviar. Escríbanos por WhatsApp. ${error.message}`;x.style.display='block';}
}
async function optimizeImage(file) {
  if(!file?.type?.startsWith('image/'))throw new Error('El archivo no es una imagen.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,fail)=>{const x=new Image();x.onload=()=>ok(x);x.onerror=()=>fail(new Error('No se pudo leer la imagen.'));x.src=url;});
    let scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight)),blob=null,canvas=null;
    for(let attempt=0;attempt<4;attempt++){
      const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
      let quality=.84;blob=await canvasToBlob(canvas,quality);while(blob.size>C.maxUploadBytes&&quality>.48){quality-=.08;blob=await canvasToBlob(canvas,quality);}if(blob.size<=C.maxUploadBytes)break;scale*=.78;
    }
    if(!blob||blob.size>1500000)throw new Error('La foto sigue siendo demasiado pesada. Pruebe con otra imagen.');
    return {name:String(file.name||`foto-${Date.now()}.jpg`).replace(/\.[^.]+$/,'')+'.jpg',mimeType:'image/jpeg',base64:await blobToBase64(blob)};
  }finally{URL.revokeObjectURL(url);}
}
function canvasToBlob(canvas,q){return new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(new Error('No se pudo optimizar la imagen.')),'image/jpeg',q));}
function blobToBase64(blob){return new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>fail(new Error('No se pudo preparar la imagen.'));r.readAsDataURL(blob);});}
async function handleFotos(fileList) {
  const files=Array.from(fileList||[]).filter(f=>f.type.startsWith('image/')),available=C.maxPhotos-editFotos.filter(Boolean).length;
  if(available<=0)return alert(`Ya tiene ${C.maxPhotos} fotos.`);
  const queue=files.slice(0,available);if(!queue.length)return;if(files.length>available)alert(`Solo se subirán ${available} fotos.`);
  const bar=document.getElementById('fbar'),fill=document.getElementById('fbar-fill');bar.style.display='block';let done=0;
  for(const file of queue){const idx=editFotos.length;editFotos.push(null);renderFotoGrid();try{const result=await gas('uploadPropertyImage',adminToken,await optimizeImage(file));editFotos[idx]=result.photo;if(result.photo?.fileId)newPhotoIds.add(String(result.photo.fileId));}catch(error){editFotos.splice(idx,1);alert(`No se pudo subir “${file.name}”: ${error.message}`);}done++;fill.style.width=Math.round(done/queue.length*100)+'%';renderFotoGrid();}
  setTimeout(()=>{bar.style.display='none';fill.style.width='0%';},700);document.getElementById('finput').value='';
}
function renderFotoGrid(){const grid=document.getElementById('fgrid');if(!grid)return;const real=editFotos.filter(Boolean);grid.innerHTML=editFotos.map((p,i)=>p?`<div class="foto-thumb"><img src="${esc(photoUrl(p))}" alt="Foto"><button type="button" class="foto-thumb-del" onclick="delFoto(${i})">✕</button></div>`:'<div class="foto-thumb"><div class="foto-uploading"><div class="foto-spin"></div><span>Subiendo…</span></div></div>').join('');document.getElementById('finfo').textContent=real.length?`${real.length}/${C.maxPhotos} fotos guardadas en Firebase`:'';}
function delFoto(i){const p=editFotos[i],id=photoId(p);if(id){if(newPhotoIds.has(id)){newPhotoIds.delete(id);gas('deletePropertyImage',adminToken,id).catch(()=>{});}else if(originalPhotoIds.has(id))removedExistingPhotoIds.add(id);}editFotos.splice(i,1);renderFotoGrid();}
const fzone=document.getElementById('fzone');if(fzone){['dragenter','dragover'].forEach(t=>fzone.addEventListener(t,e=>{e.preventDefault();fzone.classList.add('drag');}));['dragleave','drop'].forEach(t=>fzone.addEventListener(t,e=>{e.preventDefault();fzone.classList.remove('drag');}));fzone.addEventListener('drop',e=>handleFotos(e.dataTransfer.files));}
const obs='IntersectionObserver'in window?new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible');}),{threshold:.12}):null;document.querySelectorAll('.fade-in').forEach(el=>obs?obs.observe(el):el.classList.add('visible'));
window.addEventListener('scroll',()=>{const n=document.getElementById('navbar');if(n)n.style.background=window.scrollY>60?'rgba(7,15,26,.98)':'rgba(13,27,42,.97)';},{passive:true});
function toggleMenu(){menuOpen=!menuOpen;document.querySelector('.nav-links')?.classList.toggle('menu-open',menuOpen);}window.addEventListener('resize',()=>{if(window.innerWidth>900&&menuOpen)toggleMenu();});document.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>{if(menuOpen)toggleMenu();}));

const BOT=[
 {k:['disponible','disponibilidad'],r:n=>`¡Hola${n?', '+n:''}! 😊 Revise nuestro Instagram o cuéntenos qué busca.`,s:['¿El precio es conversable?','Quiero agendar una visita','¿Qué sectores tienen?']},
 {k:['precio','conversable','rebaja','oferta'],r:()=>`El valor puede conversarse según cada propiedad y las condiciones de la oferta.`,s:['Quiero dejar mis datos','Hablar por WhatsApp']},
 {k:['visita','agendar','conocer','ver la propiedad'],r:()=>`¡Claro! Para coordinar una visita necesito su nombre y contacto.`,a:'askName'},
 {k:['comisión','comision','cuánto cobran','cuanto cobran'],r:()=>`La comisión depende del tipo de operación. Le explicaremos el valor con total transparencia.`,s:['Dejar mis datos','Hablar por WhatsApp']},
 {k:['vender','publicar','tasación','tasacion','arrendar'],r:()=>`Podemos ayudarle con valoración, publicación, filtro de interesados y cierre. ¿Cuál es su nombre?`,a:'askName'},
 {k:['whatsapp'],r:()=>`Puede escribirnos directamente al ${info.tel}.`,s:['Quiero dejar mis datos']},
 {k:['hola','buenas','buen día','buen dia'],r:n=>`¡Hola${n?', '+n:''}! 😊 ¿Busca comprar, vender o arrendar?`,s:['Comprar','Vender','Arrendar','Agendar visita']},
 {k:['gracias','listo'],r:n=>`¡Con gusto${n?', '+n:''}! Estamos para ayudarle.`,s:['Quiero agendar una visita','Hablar por WhatsApp']}
];
function toggleChat(){chatOpen=!chatOpen;document.getElementById('chat-win').classList.toggle('open',chatOpen);document.getElementById('chat-notif').style.display='none';if(chatOpen&&!chatStarted){chatStarted=true;setTimeout(()=>bMsg('¡Hola! 👋 Soy el asistente de **PBB Corretajes**. ¿En qué puedo ayudarle?'),250);setTimeout(()=>showSugs(['¿Está disponible?','¿El precio es conversable?','Quiero agendar una visita','¿Cuánto cobran?']),700);}}
function bMsg(t){chatHistory.push({de:'bot',texto:t,hora:gt()});const m=document.getElementById('cms'),d=document.createElement('div');d.className='msg bot';d.innerHTML=esc(t).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+`<div class="msg-t">${gt()}</div>`;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function uMsg(t){chatHistory.push({de:'cliente',texto:t,hora:gt()});const m=document.getElementById('cms'),d=document.createElement('div');d.className='msg user';d.innerHTML=esc(t)+`<div class="msg-t">${gt()}</div>`;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function showSugs(list){const e=document.getElementById('csg');e.innerHTML=list.map((t,i)=>`<button type="button" class="sg" data-i="${i}">${esc(t)}</button>`).join('');e.querySelectorAll('.sg').forEach((b,i)=>b.addEventListener('click',()=>clkSug(list[i])));}
function clkSug(t){document.getElementById('csg').innerHTML='';uMsg(t);procMsg(t);}function sendMsg(){const i=document.getElementById('ci2'),t=i.value.trim();if(!t)return;i.value='';document.getElementById('csg').innerHTML='';uMsg(t);procMsg(t);}
function procMsg(text){const low=text.toLowerCase();if(awaitName){awaitName=false;awaitContact=true;cName=text.split(/\s+/)[0];return setTimeout(()=>bMsg(`Gracias, ${cName}! 😊 ¿Cuál es su teléfono, WhatsApp o correo?`),450);}if(awaitContact){awaitContact=false;saveCrmEvent('LEAD_CHATBOT',{_subject:`🤖 PBB — lead del chatbot: ${cName||'cliente'}`,nombre:cName,contacto:text,conversacion:chatHistory.map(x=>`${x.hora} ${x.de}: ${x.texto}`).join('\n')}).catch(()=>{});return setTimeout(()=>{bMsg(`¡Perfecto! ✅ Un corredor le contactará pronto. También puede escribirnos al ${info.tel}.`);showSugs(['Quiero agendar una visita','Ver Instagram']);},450);}const match=BOT.find(r=>r.k.some(k=>low.includes(k)));setTimeout(()=>{if(match){if(match.a==='askName')awaitName=true;bMsg(match.r(cName));if(match.s)showSugs(match.s);}else{saveCrmEvent('MENSAJE_CHATBOT',{_subject:'💬 PBB — mensaje del chatbot',mensaje:text,conversacion:chatHistory.map(x=>`${x.hora} ${x.de}: ${x.texto}`).join('\n')}).catch(()=>{});bMsg('Gracias por escribirnos 😊. Para que un corredor le contacte, déjenos su nombre y datos.');showSugs(['Dejar mis datos','Hablar por WhatsApp']);}},450);}
function gt(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}setTimeout(()=>{if(!chatOpen)document.getElementById('chat-notif').style.display='flex';},4000);

function showLogin(message=''){document.getElementById('admin-login').classList.add('active');const e=document.getElementById('lerr');e.textContent=message||'Contraseña incorrecta';e.style.display=message?'block':'none';setTimeout(()=>document.getElementById('lp').focus(),100);}function closeLogin(){document.getElementById('admin-login').classList.remove('active');document.getElementById('lp').value='';document.getElementById('lerr').style.display='none';}
async function doLogin(){const input=document.getElementById('lp'),btn=document.querySelector('#admin-login .lb');btn.disabled=true;btn.textContent='Ingresando…';try{const r=await gas('loginAdmin',input.value);adminToken=r.token;sessionStore.setItem(C.sessionKey,adminToken);closeLogin();await openAdmin();}catch(e){showLogin(e.message);input.value='';}finally{btn.disabled=false;btn.textContent='Ingresar';}}
async function openAdmin(){if(!adminToken)return showLogin();document.getElementById('ao').classList.add('active');document.body.style.overflow='hidden';try{const d=await gas('getAdminData',adminToken);info={...DEFAULT_INFO,...(d.info||{})};props=d.properties||[];deletedProps=d.deletedProperties||[];crmRows=d.crm||[];adminSystem=d.system||{};populateAdmin();renderContacto();renderProps();renderAdminProps();renderStats();}catch(e){document.getElementById('ao').classList.remove('active');document.body.style.overflow='';if(/sesión|sesion|venció|vencio/i.test(e.message)){adminToken='';sessionStore.removeItem(C.sessionKey);showLogin(e.message);}else alert('No se pudo abrir el panel: '+e.message);}}
function populateAdmin(){document.getElementById('a-tel').value=info.tel||'';document.getElementById('a-email').value=info.email||'';document.getElementById('a-dir').value=info.dir||'';document.getElementById('a-horario').value=info.horario||'';setSystemLink('db-link',adminSystem.spreadsheetUrl,'Abrir base de datos');setSystemLink('photos-link',adminSystem.imageFolderUrl,'Abrir carpeta de fotos');setSystemLink('backup-link',adminSystem.currentBackupUrl,'Abrir respaldo actual');setSystemLink('history-link',adminSystem.backupFolderUrl,'Historial de respaldos');document.getElementById('system-version').textContent=adminSystem.version?`Versión ${adminSystem.version}`:'';}
function setSystemLink(id,href,label){const el=document.getElementById(id);if(!el)return;el.textContent=label;el.href=href||'#';el.style.opacity=href?'1':'.45';el.style.pointerEvents=href?'auto':'none';}
function closeAdmin(){cleanupUnsavedUploads();clearPropertyForm(false);document.getElementById('ao').classList.remove('active');document.body.style.overflow='';}
function swTab(t){document.querySelectorAll('.atab').forEach((b,i)=>b.classList.toggle('active',['info','props','stats'][i]===t));document.querySelectorAll('.apanel').forEach(p=>p.classList.remove('active'));document.getElementById('tab-'+t).classList.add('active');if(t==='stats')refreshAdminData().catch(()=>{});}
async function refreshAdminData(){const d=await gas('getAdminData',adminToken);info={...DEFAULT_INFO,...(d.info||{})};props=d.properties||[];deletedProps=d.deletedProperties||[];crmRows=d.crm||[];adminSystem=d.system||{};populateAdmin();renderAdminProps();renderStats();renderProps();}
async function saveInfo(){const btn=document.querySelector('#tab-info .asb');btn.disabled=true;btn.textContent='Guardando…';const next={tel:document.getElementById('a-tel').value.trim(),email:document.getElementById('a-email').value.trim(),dir:document.getElementById('a-dir').value.trim(),horario:document.getElementById('a-horario').value.trim()};try{const r=await gas('saveSiteInfo',adminToken,next);info={...DEFAULT_INFO,...(r.info||next)};renderContacto();showMsg('info-msg','✅ Información guardada en Firebase y respaldada automáticamente.',true);await loadPublicData({silent:true});}catch(e){handleAdminError(e,'info-msg');}finally{btn.disabled=false;btn.textContent='Guardar cambios';}}
function renderAdminProps(){
  const l=document.getElementById('pal');if(!l)return;
  if(!props.length)l.innerHTML='<p style="color:rgba(255,255,255,.3);font-size:14px;padding:12px">No hay propiedades publicadas.</p>';
  else l.innerHTML=props.map((p,i)=>`<div class="pai"><div><h4>${esc(p.titulo)}</h4><span>${esc(p.tipo)} · ${esc(p.sector||'')} · ${esc(p.precio)} · ☁️ ${(p.fotos||[]).length} foto(s)</span></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="pab2">${esc(p.disp)}</span><div class="paa"><button type="button" class="be" onclick="editProp(${i})">✏️ Editar</button><button type="button" class="bd" onclick="delProp('${esc(p.id)}')">🗑 Papelera</button></div></div></div>`).join('');
  renderDeletedProps();
}
function renderDeletedProps(){
  const list=document.getElementById('trash-list'),count=document.getElementById('trash-count');if(!list||!count)return;
  count.textContent=`${deletedProps.length} ${deletedProps.length===1?'propiedad':'propiedades'}`;
  if(!deletedProps.length){list.innerHTML='<p style="color:rgba(255,255,255,.3);font-size:13px;padding:8px">La papelera está vacía.</p>';return;}
  list.innerHTML=deletedProps.map(p=>`<div class="trash-item"><div><strong>${esc(p.titulo)}</strong><span>${esc(p.tipo)} · ${esc(p.sector||'')} · eliminada ${esc(p.updated_at||'')}</span></div><button type="button" class="restore-btn" onclick="restoreDeletedProp('${esc(p.id)}')">↩ Restaurar</button></div>`).join('');
}
async function restoreDeletedProp(id){
  try{await gas('restoreDeletedProperty',adminToken,id);await refreshAdminData();showMsg('prop-msg','✅ Propiedad restaurada y publicada nuevamente.',true);setSyncStatus('Propiedades sincronizadas con Firebase.','ok');}
  catch(e){handleAdminError(e,'prop-msg');}
}

async function saveProp(){const title=document.getElementById('p-tit').value.trim();if(!title)return showMsg('prop-msg','⚠️ El título es obligatorio.',false);if(editFotos.some(x=>x===null))return showMsg('prop-msg','⏳ Espere a que terminen de subir las fotos.',false);const btn=document.getElementById('save-prop-btn');btn.disabled=true;btn.textContent='Guardando en Firebase…';const data={id:document.getElementById('peid').value,titulo:title,tipo:document.getElementById('p-tipo').value,disp:document.getElementById('p-disp').value,precio:document.getElementById('p-prec').value.trim(),dorm:document.getElementById('p-dorm').value.trim(),banos:document.getElementById('p-ban').value.trim(),m2:document.getElementById('p-m2').value.trim(),sector:document.getElementById('p-sec').value.trim(),descripcion:document.getElementById('p-desc').value.trim(),fotos:editFotos.filter(Boolean),removedPhotoIds:[...removedExistingPhotoIds]};try{await gas('saveProperty',adminToken,data);newPhotoIds.clear();removedExistingPhotoIds.clear();originalPhotoIds.clear();await refreshAdminData();clearPropertyForm(false);showMsg('prop-msg',`✅ Propiedad guardada correctamente con ${data.fotos.length} foto(s).`,true);setSyncStatus('Propiedades sincronizadas con Firebase.','ok');}catch(e){handleAdminError(e,'prop-msg');}finally{btn.disabled=false;btn.textContent='Guardar propiedad';}}
function editProp(i){cleanupUnsavedUploads();const p=props[i];if(!p)return;document.getElementById('pft').textContent='✏️ Editar propiedad';document.getElementById('peid').value=p.id||'';document.getElementById('p-tit').value=p.titulo||'';document.getElementById('p-tipo').value=p.tipo||'Casa';document.getElementById('p-disp').value=p.disp||'Venta';document.getElementById('p-prec').value=p.precio||'';document.getElementById('p-dorm').value=p.dorm||'';document.getElementById('p-ban').value=p.banos||'';document.getElementById('p-m2').value=p.m2||'';document.getElementById('p-sec').value=p.sector||'';document.getElementById('p-desc').value=p.descripcion||'';editFotos=(p.fotos||[]).slice();originalPhotoIds=new Set(editFotos.map(photoId).filter(Boolean));newPhotoIds.clear();removedExistingPhotoIds.clear();renderFotoGrid();document.querySelector('.apf').scrollIntoView({behavior:'smooth',block:'start'});}
async function delProp(id){if(!confirm('¿Mover esta propiedad a la papelera? Podrá restaurarla desde este mismo panel.'))return;try{await gas('deleteProperty',adminToken,id);await refreshAdminData();showMsg('prop-msg','✅ Propiedad movida a la papelera recuperable.',true);setSyncStatus('Propiedades sincronizadas con Firebase.','ok');}catch(e){handleAdminError(e,'prop-msg');}}
function cancelEdit(){cleanupUnsavedUploads();clearPropertyForm(false);}function cleanupUnsavedUploads(){[...newPhotoIds].forEach(id=>gas('deletePropertyImage',adminToken,id).catch(()=>{}));newPhotoIds.clear();removedExistingPhotoIds.clear();originalPhotoIds.clear();}
function clearPropertyForm(cleanup=true){if(cleanup)cleanupUnsavedUploads();document.getElementById('pft').textContent='➕ Agregar nueva propiedad';document.getElementById('peid').value='';['p-tit','p-prec','p-dorm','p-ban','p-m2','p-sec','p-desc'].forEach(id=>document.getElementById(id).value='');document.getElementById('p-tipo').value='Casa';document.getElementById('p-disp').value='Venta';editFotos=[];renderFotoGrid();}
function showMsg(id,text,ok){const e=document.getElementById(id);e.textContent=text;e.className='amsg '+(ok?'ok':'err');e.style.display='block';clearTimeout(e._t);e._t=setTimeout(()=>e.style.display='none',7000);}function handleAdminError(e,id){if(/sesión|sesion|venció|vencio/i.test(e.message)){adminToken='';sessionStore.removeItem(C.sessionKey);document.getElementById('ao').classList.remove('active');document.body.style.overflow='';showLogin(e.message);}else showMsg(id,'❌ '+e.message,false);}
function renderStats(){const events=crmRows.length?crmRows.map(r=>({prop:r.data?.propiedad||r.tipo,id:r.id,hora:r.created_at?new Date(r.created_at).toLocaleString('es-CL'):'',ts:r.created_at?new Date(r.created_at).getTime():0,ref:r.data?.origen||r.tipo})):visits;const el=document.getElementById('stats-cards');if(!el)return;const total=events.length,today=events.filter(v=>v.ts&&new Date(v.ts).toDateString()===new Date().toDateString()).length,counts={};events.forEach(v=>counts[v.prop]=(counts[v.prop]||0)+1);const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];el.innerHTML=`<div class="sc"><div class="sc-n">${total}</div><div class="sc-l">Eventos CRM</div></div><div class="sc"><div class="sc-n">${today}</div><div class="sc-l">Eventos hoy</div></div><div class="sc"><div class="sc-n" style="font-size:14px;padding-top:10px">${top?esc(top[0]).substring(0,22)+'…':'—'}</div><div class="sc-l">Más repetido${top?' ('+top[1]+')':''}</div></div>`;const list=document.getElementById('vl');if(!events.length){list.innerHTML='<p style="color:rgba(255,255,255,.3);font-size:14px;padding:12px">Sin eventos aún.</p>';return;}list.innerHTML=events.slice(0,80).map(v=>`<div class="vi"><div><h5>📌 ${esc(v.prop)}</h5><p>📅 ${esc(v.hora)} · 🌐 ${esc(v.ref)}</p></div><span class="vbadge">CRM</span></div>`).join('');}
async function restoreBackup(){if(!confirm('Esto reemplazará la base actual por el respaldo anterior completo. ¿Continuar?'))return;const btn=document.getElementById('restore-btn');btn.disabled=true;btn.textContent='Restaurando…';try{await gas('restorePreviousBackup',adminToken);await refreshAdminData();showMsg('system-msg','✅ Respaldo anterior restaurado correctamente.',true);}catch(e){handleAdminError(e,'system-msg');}finally{btn.disabled=false;btn.textContent='↩ Restaurar respaldo anterior';}}
async function changePassword(){const current=prompt('Ingrese la contraseña actual:');if(current===null)return;const next=prompt('Ingrese una nueva contraseña de al menos 10 caracteres:');if(next===null)return;const confirmNext=prompt('Repita la nueva contraseña:');if(confirmNext!==next)return alert('Las contraseñas no coinciden.');try{await gas('changeAdminPassword',adminToken,current,next);adminToken='';sessionStore.removeItem(C.sessionKey);closeAdmin();alert('Contraseña actualizada. Ingrese nuevamente.');showLogin();}catch(e){showMsg('system-msg','❌ '+e.message,false);}}
if(new URLSearchParams(location.search).has('admin')){if(adminToken)openAdmin();else showLogin();}
const year=document.getElementById('footer-year');if(year)year.textContent=String(new Date().getFullYear());
renderContacto();hydrateFromCache();loadPublicData({force:true}).catch(()=>{});
window.addEventListener('focus',()=>refreshPublicIfNeeded());
window.addEventListener('pageshow',e=>refreshPublicIfNeeded(Boolean(e.persisted)));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshPublicIfNeeded();});
setInterval(()=>refreshPublicIfNeeded(),120000);

