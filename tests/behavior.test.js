const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, {id, style: {}, value: '', textContent: '', innerHTML: '', getContext: () => ({})});
  return nodes.get(id);
};
let clock = 100000;
class TestDate extends Date { static now() { return clock; } }
let timerId = 0;
const timers = new Map();
const values = new Map();
let reloads = 0;
const context = {
  console, Date: TestDate, Math, JSON, TextEncoder, crypto: require('node:crypto').webcrypto,
  document: {getElementById: node},
  localStorage: {getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v)},
  addEventListener() {}, requestAnimationFrame() {}, setInterval() {},
  setTimeout: (f,ms) => {const id = ++timerId; timers.set(id, {f,ms}); return id;},
  clearTimeout: id => timers.delete(id),
  location: {reload() {reloads++;}},
  CHRONO_FIREBASE_CONFIG: null,
  Peer: function() {},
  firebase: {database: Object.assign(() => context.mockDb, {ServerValue: {TIMESTAMP: 12345}})}
};
context.window = context;
vm.createContext(context);
const run = source => vm.runInContext(source, context);
const plain = source => JSON.parse(JSON.stringify(run(source)));
run(code);
assert.equal(run('LV.length'), 30);
assert.match(node('net').textContent, /Firebase pendiente/);
assert.equal(run('adminRole({a:true}, "a")'), true);
assert.equal(run('adminRole({a:true}, "b")'), false);
run('serverOffset=2500; MT={startAt:103000,endAt:110000}');
assert.equal(run('phase()'), 'count');
clock = 102000; assert.equal(run('phase()'), 'run');
clock = 108000; assert.equal(run('phase()'), 'over');

// Execute the actual game functions, not copies of their implementations.
run('MT=null; MP.run=false; MP.over=false; load(0); step("R"); newLoop(true); step("D")');
const snapshot = plain('progressSnapshot()');
context.saved = JSON.stringify(snapshot);
run('load(0)');
assert.equal(run('restoreProgress(saved)'), true);
assert.deepEqual(plain('progressSnapshot()'), snapshot);
assert.equal(run('restoreProgress("not json")'), false);
context.emptySnapshot = JSON.stringify({...snapshot, moves: [], clones: [], clonePositions: [], blocks: [], t: 0});
assert.equal(run('restoreProgress(emptySnapshot)'), true);
assert.deepEqual(plain('cur'), []);
assert.deepEqual(plain('recs'), []);

(async () => {
  const writes = [];
  let remote = {name:'Joan',matchId:'m1',solved:2,score:900,t:1,progress:JSON.stringify(snapshot)};
  context.mockDb = {ref: () => ({once:async()=>({val:()=>remote}),update:async value=>{writes.push(value);}})};
  node('nick').value='Joan';node('joinCode').value='A7K2Q9';
  run('db=mockDb; MP.id="p1"; MP.joined=false; MP.run=false; MP.seen=""; MP.solved=0; MT={id:"m1",code:"A7K2Q9",startAt:null,endAt:null,ban:[]}; PL=[]');
  await run('join()');
  assert.equal(writes.length,0,'rejoining cannot overwrite the remote snapshot');
  assert.equal(run('MP.score'),900);assert.equal(run('MP.solved'),2);
  run('startRun()');
  assert.deepEqual(plain('P'),snapshot.position);assert.equal(run('t'),snapshot.t);assert.equal(run('MP.score'),900);
  await run('savePlayer()');
  assert.equal(typeof writes.at(-1).progress,'string','JSON also preserves empty arrays in RTDB');
  assert.deepEqual(JSON.parse(writes.at(-1).progress).clonePositions,snapshot.clonePositions);

  run('PL=[]; MP.solved=2; MP.score=900; load(2); MP.lvT=serverNow(); win()');
  const score=run('MP.score');assert.equal(run('MP.solved'),3);
  run('win()');assert.equal(run('MP.score'),score,'a level cannot score twice');
  context.completed=JSON.stringify({...snapshot,level:2,state:'win'});
  run('MP.pendingProgress=completed; startRun()');
  assert.equal(run('li'),3,'an already-scored victory continues to the next level');assert.equal(run('state'),'play');

  writes.length=0;remote=null;
  run('MP.run=false; MP.joined=false; MP.solved=0; MP.score=0; MP.seen=""; MT.startAt=null; load(20)');
  await run('join()');assert.equal(writes.length,1);assert.equal('progress' in writes[0],false);
  run('PL=[]; startRun()');assert.equal(run('li'),0,'a new player does not inherit their practice level');
  run('db=null; window.CHRONO_FIREBASE_CONFIG={}; MP.run=false');
  await run('join()');assert.match(run('MP.err'),/sincronizando/i);

  // Cloud play never falls back to peer hosting or joins before player sync.
  let peerCalls=0;
  context.peerJoinProbe=async()=>{peerCalls++};
  context.peerHostProbe=async()=>{peerCalls++;return Promise.resolve()};
  run('db={ref:()=>({once:async()=>({val:()=>null}),update:async()=>{}})};usr=null;networkState.ready=false;MT={id:"cloud-room",code:"ZC3V29",startAt:null,endAt:null,ban:[]};MP.host=false;MP.joined=false;p2pGuestJoin=peerJoinProbe');
  node('nick').value='Cloud test';node('joinCode').value='ZC3V29';
  await run('join()');assert.equal(peerCalls,0);assert.match(run('MP.err'),/sincronizando/i);
  run('networkState.error="Fallo de red";renderNetworkStatus()');
  assert.equal(node('netRetry').style.display,'');
  context.peerHostOriginal=run('p2pHostStart');
  run('MP.host=true;MP.adminUnlocked=true;MP.firebaseAdmin=true;adminDb={ref:()=>({set:async()=>{throw new Error("permission denied")}})};networkState.error="";db=null;p2pHostStart=peerHostProbe');
  await run('newMatch()');
  assert.equal(peerCalls,0,'Firebase mode must not start a P2P room');
  assert.match(run('MP.err'),/permission denied/,'failed cloud write stays visible instead of being cleared');
  run('p2pHostStart=peerHostOriginal');

  run('firebaseReady=false; MP.host=false; MP.firebaseAdmin=false; MP.adminUnlocked=false; MP.err=""; adminGate()');
  assert.match(node('ov').innerHTML,/contraseña compartida/,'admin form is reachable before player connection finishes');
  assert.doesNotMatch(node('ov').innerHTML,/Conectando con Firebase|cuenta Google|Configurar administrador/);

  const authCalls=[];
  let authMock;
  const authFactory=()=>authMock;authFactory.GoogleAuthProvider=function(){};context.firebase.auth=authFactory;
  const installAuth=mock=>{authMock=mock;context.authMock=mock;run('playerAuth=authMock; usr=authMock.currentUser; MP.err=""')};
  const anonymous={uid:'anon-uid',isAnonymous:true};
  anonymous.linkWithPopup=async()=>{authCalls.push('linkWithPopup');throw {code:'auth/popup-blocked'}};
  anonymous.linkWithRedirect=async()=>{authCalls.push('linkWithRedirect')};
  installAuth({currentUser:anonymous});
  const beforeRedirect=reloads;await run('signInGoogle()');
  assert.deepEqual(authCalls,['linkWithPopup','linkWithRedirect'],'blocked linking uses one redirect and no second sign-in');
  assert.equal(reloads,beforeRedirect,'redirect is not interrupted by reload');

  authCalls.length=0;
  anonymous.linkWithPopup=async()=>{authCalls.push('linkWithPopup');authMock.currentUser={uid:'anon-uid',isAnonymous:false};return {user:authMock.currentUser}};
  installAuth({currentUser:anonymous,signInWithPopup:async()=>{authCalls.push('signInWithPopup')}});
  await run('signInGoogle()');assert.deepEqual(authCalls,['linkWithPopup']);assert.equal(run('MP.id'),'anon-uid','Google linking retains the anonymous player UID');
  assert.equal(run('MP.firebaseAdmin'),false,'optional player Google never grants admin');
  assert.equal(run('MP.adminUnlocked'),false);

  authCalls.length=0;
  anonymous.linkWithPopup=async()=>{authCalls.push('linkWithPopup');throw {code:'auth/credential-already-in-use'}};
  installAuth({currentUser:anonymous,signInWithPopup:async()=>{authCalls.push('signInWithPopup');authMock.currentUser={uid:'existing-google-uid'};return {user:authMock.currentUser}}});
  await run('signInGoogle()');assert.deepEqual(authCalls,['linkWithPopup','signInWithPopup']);assert.equal(run('MP.id'),'existing-google-uid');

  authCalls.length=0;
  installAuth({currentUser:{uid:'existing-google-uid'},signInWithPopup:async()=>{authCalls.push('signInWithPopup');throw {code:'auth/popup-blocked'}},signInWithRedirect:async()=>{authCalls.push('signInWithRedirect')}});
  const beforeSignInRedirect=reloads;await run('signInGoogle()');
  assert.deepEqual(authCalls,['signInWithPopup','signInWithRedirect']);assert.equal(reloads,beforeSignInRedirect);
  console.log('behavior tests: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
