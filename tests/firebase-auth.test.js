const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

const tickMicrotasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return {promise, resolve, reject};
};

function makeHarness({configured = true, playerAuth, adminAuths = [], role = true} = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const storageWrites = [];
  const nodes = new Map();
  const apps = [];
  const refs = [];
  const dbWrites = [];
  const warnings = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {id, style: {}, value: '', textContent: '', innerHTML: '',
      getContext: () => ({})});
    return nodes.get(id);
  };
  const schedule = (fn, ms = 0) => { const id = nextTimer++; timers.set(id, {at: now + ms, fn}); return id; };
  const clear = id => timers.delete(id);
  const advance = async ms => {
    now += ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      if (!due.length) break;
      for (const [id, t] of due) { if (timers.has(id)) { timers.delete(id); t.fn(); } }
      await tickMicrotasks();
    }
  };
  const makeRef = (app, pathName) => {
    const ref = {app, path: pathName, listeners: new Map(), onCount: 0, offCount: 0,
      writes: [], nextOnce: null,
      on(event, fn) { this.onCount++; if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(fn); return fn; },
      off(event, fn) { this.offCount++; if (!event) this.listeners.clear(); else if (this.listeners.has(event)) { if (fn) this.listeners.get(event).delete(fn); else this.listeners.delete(event); } },
      emit(event, value, exists = true) { for (const fn of [...(this.listeners.get(event) || [])]) fn({val: () => value, exists: () => exists}); },
      once() { return this.nextOnce || Promise.resolve({val: () => (pathName.startsWith('admins/') ? role : null), exists: () => pathName.startsWith('admins/') ? role : false}); },
      set(value) { this.writes.push(['set', value]); dbWrites.push({app, path: pathName, op: 'set', value}); return Promise.resolve(); },
      update(value) { this.writes.push(['update', value]); dbWrites.push({app, path: pathName, op: 'update', value}); return Promise.resolve(); },
      remove() { this.writes.push(['remove']); dbWrites.push({app, path: pathName, op: 'remove'}); return Promise.resolve(); }
    };
    refs.push(ref); return ref;
  };
  const makeDb = app => ({ref(pathName) { const existing = refs.find(r => r.app === app && r.path === pathName); return existing || makeRef(app, pathName); }});
  const makeAuth = (app, supplied, index) => {
    const auth = supplied || {currentUser: null,
      setPersistence: () => Promise.resolve(),
      getRedirectResult: () => Promise.resolve({}),
      onAuthStateChanged: cb => { cb(auth.currentUser); return () => {}; },
      signInAnonymously: () => Promise.resolve({user: {uid: 'player-uid'}}),
      signInWithEmailAndPassword: () => Promise.reject(Object.assign(new Error('wrong'), {code: 'auth/wrong-password'})),
      signOut: () => Promise.resolve()};
    if (!auth.onAuthStateChanged && auth.currentUser !== undefined) auth.onAuthStateChanged = cb => { cb(auth.currentUser); return () => {}; };
    auth.app = app; auth.index = index; return auth;
  };
  const firebase = {
    apps,
    database: Object.assign(app => app.db, {ServerValue: {TIMESTAMP: 1}}),
    auth: app => app.auth,
    app: () => { const a = apps.find(x => !x.name); if (!a) throw new Error('no default app'); return a; },
    initializeApp(cfg, name) {
      const app = {name: name || '', auth: null, db: null};
      const index = apps.length;
      app.auth = makeAuth(app, name ? adminAuths[index - 1] : playerAuth, index);
      app.db = makeDb(app); apps.push(app); return app;
    },
    GoogleAuthProvider: function GoogleAuthProvider() {}
  };
  firebase.auth.Auth = {Persistence: {LOCAL: 'local', NONE: 'none'}};
  const context = {
    console: {log() {}, warn: (...args) => warnings.push(args), error() {}}, Date: class extends Date { static now() { return now; } }, Math, JSON,
    TextEncoder, crypto: require('node:crypto').webcrypto,
    document: {getElementById: node}, localStorage: {getItem: () => null, setItem: (k, v) => storageWrites.push(['local', k, String(v)])},
    sessionStorage: {getItem: () => null, setItem: (k, v) => storageWrites.push(['session', k, String(v)]), removeItem() {}},
    addEventListener() {}, requestAnimationFrame() {}, setInterval() {}, setTimeout: schedule, clearTimeout: clear,
    location: {reload() {}}, Peer: function Peer() {}, firebase, CHRONO_FIREBASE_CONFIG: configured ? {apiKey: 'test', databaseURL: 'test'} : null
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename: 'index.html'});
  return {context, node, apps, refs, dbWrites, storageWrites, warnings, advance, tickMicrotasks, schedule, firebase};
}

function emitAdminInitial(h, match = null, players = {}) {
  const app = [...h.apps].reverse().find(a => /^chrono-shift-admin-/.test(a.name));
  assert.ok(app, 'admin app should be created');
  h.refs.find(r => r.app === app && r.path === '.info/connected')?.emit('value', true);
  h.refs.find(r => r.app === app && r.path === 'match/state')?.emit('value', match, !!match);
  h.refs.find(r => r.app === app && r.path === 'players')?.emit('value', players, true);
}

function emitPlayerInitial(h, match = null, players = {}) {
  const app = h.apps.find(a => !a.name);
  h.refs.find(r => r.app === app && r.path === 'match/state')?.emit('value', match, !!match);
  h.refs.find(r => r.app === app && r.path === 'players')?.emit('value', players, true);
}

function invokeValue(ref, value, exists = true) {
  assert.ok(ref, 'expected Firebase reference');
  const snapshot = {val: () => value, exists: () => exists};
  for (const fn of [...(ref.listeners.get('value') || [])]) fn(snapshot);
}

const failures = [];
async function run(name, fn) {
  try { await fn(); console.log(`firebase auth test: ${name}: OK`); }
  catch (error) { failures.push({name, error}); console.error(`firebase auth test: ${name}: FAIL`, error.message); }
}

(async () => {
  await run('wrong password stays locked and performs no database writes', async () => {
    const admin = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => Promise.reject(Object.assign(new Error('bad'), {code: 'auth/wrong-password'})), signOut: () => Promise.resolve()};
    const h = makeHarness({adminAuths: [admin]});
    await h.tickMicrotasks(); h.node('adminPass').value = 'wrong-password';
    await vm.runInContext('MP.host=false;MP.adminUnlocked=false;MP.firebaseAdmin=false;firebaseReady=true;firebaseApp=firebase.apps[0];adminGate();adminLogin()', h.context);
    await h.tickMicrotasks();
    assert.equal(vm.runInContext('isAdmin()', h.context), false);
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), false);
    assert.equal(h.dbWrites.length, 0);
  });

  await run('unauthorized role is rejected', async () => {
    const admin = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => Promise.resolve({user: {uid: 'not-admin'}}), signOut: () => Promise.resolve()};
    const h = makeHarness({adminAuths: [admin], role: false});
    await h.tickMicrotasks(); h.node('adminPass').value = 'correct-password';
    const login = vm.runInContext('firebaseReady=true;firebaseApp=firebase.apps[0];adminGate();adminLogin()', h.context);
    await h.tickMicrotasks(); emitAdminInitial(h); await login; await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), false);
    assert.equal(vm.runInContext('MP.firebaseAdmin', h.context), false);
    assert.match(vm.runInContext('MP.err', h.context), /rol|administrador/i);
  });

  await run('authorized admin unlock preserves player identity and auth', async () => {
    const playerAuth = {currentUser: {uid: 'player-uid'}, setPersistence: () => Promise.resolve(), getRedirectResult: () => Promise.resolve({})};
    const admin = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => Promise.resolve({user: {uid: 'admin-uid'}}), signOut: () => Promise.resolve()};
    const h = makeHarness({playerAuth, adminAuths: [admin], role: true});
    await h.tickMicrotasks();
    vm.runInContext('usr=playerAuth.currentUser;MP.id="player-uid";firebaseReady=true;firebaseApp=firebase.apps[0];adminGate()', h.context);
    h.node('adminPass').value = 'correct-password'; const login = vm.runInContext('adminLogin()', h.context); await h.tickMicrotasks(); emitAdminInitial(h); await login; await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.id', h.context), 'player-uid');
    assert.equal(vm.runInContext('usr.uid', h.context), 'player-uid');
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), true);
    assert.equal(vm.runInContext('MP.firebaseAdmin', h.context), true);
    assert.equal(vm.runInContext('isAdmin()', h.context), true);
    assert.equal(vm.runInContext('playerAuth===firebase.apps[0].auth', h.context), true);
  });

  await run('late player initialization cannot clear a successful admin session', async () => {
    const playerReady = deferred();
    const playerAuth = {currentUser: null, setPersistence: () => playerReady.promise, getRedirectResult: () => Promise.resolve({}), signInAnonymously: () => Promise.resolve({user: {uid: 'late-player'}})};
    const admin = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => Promise.resolve({user: {uid: 'admin-uid'}}), signOut: () => Promise.resolve()};
    const h = makeHarness({playerAuth, adminAuths: [admin]});
    h.node('adminPass').value = 'correct-password';
    const login = vm.runInContext('adminLogin()', h.context); await h.tickMicrotasks();
    emitAdminInitial(h); await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), true, 'admin must not await player init');
    playerReady.resolve(); await h.tickMicrotasks(); await login; await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), true);
    assert.equal(vm.runInContext('MP.firebaseAdmin', h.context), true);
    assert.equal(vm.runInContext('MP.host', h.context), true);
  });

  await run('admin form remains reachable while player init is pending', async () => {
    const pending = deferred();
    const playerAuth = {currentUser: null, setPersistence: () => pending.promise};
    const h = makeHarness({playerAuth});
    vm.runInContext('adminGate()', h.context);
    assert.match(h.node('ov').innerHTML, /adminPass/);
    assert.equal(h.node('ov').style.display, 'flex');
  });

  await run('player timeout is visible and stale connected callback cannot turn it green', async () => {
    const pending = deferred();
    const h = makeHarness({playerAuth: {currentUser: null, setPersistence: () => pending.promise}});
    const connected = h.refs.find(r => r.path === '.info/connected');
    assert.ok(connected, 'connected listener should be installed');
    invokeValue(connected, true);
    await h.advance(9001);
    assert.match(h.node('net').textContent, /desconectado|reintenta|🔴/i);
    invokeValue(connected, true);
    assert.match(h.node('net').textContent, /desconectado|reintenta|🔴/i);
    pending.resolve(); await h.tickMicrotasks();
  });

  await run('retry reuses the default app and leaves one live listener per reference', async () => {
    const first = deferred(); let persistenceCalls = 0;
    const h = makeHarness({playerAuth: {currentUser: null, setPersistence: () => ++persistenceCalls === 1 ? first.promise : Promise.resolve(), onAuthStateChanged: cb => { cb({uid: 'player-uid'}); return () => {}; }, signInAnonymously: () => Promise.resolve({user: {uid: 'player-uid'}})}});
    await h.advance(9001); await h.tickMicrotasks();
    const oldRefs = h.refs.filter(r => r.app.name === '' && ['.info/connected', '.info/serverTimeOffset', 'match/state', 'players'].includes(r.path));
    const retry = vm.runInContext('netInit()', h.context); await h.tickMicrotasks();
    first.resolve(); await h.tickMicrotasks(); emitPlayerInitial(h); await h.tickMicrotasks(); await retry; await h.tickMicrotasks();
    assert.equal(h.apps.filter(a => a.name === '').length, 1);
    const live = h.refs.filter(r => r.app.name === '' && r.listeners.get('value')?.size);
    for (const pathName of ['.info/connected', '.info/serverTimeOffset', 'match/state', 'players']) assert.equal(live.filter(r => r.path === pathName).length, 1, pathName);
    assert.ok(oldRefs.some(r => r.offCount > 0), 'retry must detach old listeners');
  });

  await run('timed-out admin attempt cannot invalidate a newer successful attempt', async () => {
    const first = deferred(), second = deferred();
    const a1 = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => first.promise, signOut: () => Promise.resolve()};
    const a2 = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => second.promise, signOut: () => Promise.resolve()};
    const h = makeHarness({adminAuths: [a1, a2]});
    h.node('adminPass').value = 'correct-password'; const p1 = vm.runInContext('adminLogin()', h.context);
    await h.advance(9001); await h.tickMicrotasks();
    h.node('adminPass').value = 'correct-password'; const p2 = vm.runInContext('adminLogin()', h.context);
    second.resolve({user: {uid: 'admin-2'}}); await h.tickMicrotasks(); emitAdminInitial(h); await h.tickMicrotasks(); await p2; await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), true);
    first.resolve({user: {uid: 'admin-1'}}); await h.tickMicrotasks(); await p1; await h.tickMicrotasks();
    assert.equal(vm.runInContext('MP.adminUnlocked', h.context), true);
    assert.equal(vm.runInContext('MP.firebaseAdmin', h.context), true);
    assert.match(vm.runInContext('adminApp.name', h.context), /^chrono-shift-admin-\d+$/);
    assert.equal(h.apps.filter(a => /^chrono-shift-admin-/.test(a.name)).length, 2);
  });

  await run('password is not persisted as a credential or localStorage value', async () => {
    const admin = {setPersistence: () => Promise.resolve(), signInWithEmailAndPassword: () => Promise.resolve({user: {uid: 'admin-uid'}}), signOut: () => Promise.resolve()};
    const h = makeHarness({adminAuths: [admin]});
    await h.tickMicrotasks(); h.node('adminPass').value = 'correct-password';
    const login = vm.runInContext('firebaseReady=true;firebaseApp=firebase.apps[0];adminGate();adminLogin()', h.context); await h.tickMicrotasks(); emitAdminInitial(h); await login; await h.tickMicrotasks();
    assert.equal(h.storageWrites.some(([, , value]) => value.includes('correct-password')), false);
    assert.equal(h.dbWrites.some(w => JSON.stringify(w).includes('correct-password')), false);
  });

  if (failures.length) {
    console.error(`firebase auth tests: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.error.stack || failure.error}`);
    process.exitCode = 1;
  } else console.log('firebase auth tests: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
