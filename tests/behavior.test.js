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
const context = {
  console, Date: TestDate, Math, JSON, TextEncoder,
  document: {getElementById: node},
  localStorage: {getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v)},
  addEventListener() {}, requestAnimationFrame() {}, setInterval() {},
  setTimeout: (f,ms) => {const id = ++timerId; timers.set(id, {f,ms}); return id;},
  clearTimeout: id => timers.delete(id),
  location: {reload() {}},
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

// Se ejecutan las funciones reales, no copias de sus implementaciones.
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
  let remote = {name: 'Joan', matchId: 'm1', solved: 2, score: 900, t: 1, progress: JSON.stringify(snapshot)};
  context.mockDb = {ref: () => ({once: async () => ({val: () => remote}), update: async value => {writes.push(value);}})};
  node('nick').value = 'Joan'; node('joinCode').value = 'A7K2Q9';
  run('db=mockDb; MP.id="p1"; MP.joined=false; MP.run=false; MP.seen=""; MP.solved=0; MT={id:"m1",code:"A7K2Q9",startAt:null,endAt:null,ban:[]}; PL=[]');
  await run('join()');
  assert.equal(writes.length, 0, 'unirse de nuevo no puede sobrescribir el snapshot remoto');
  assert.equal(run('MP.score'), 900);
  assert.equal(run('MP.solved'), 2);
  run('startRun()');
  assert.deepEqual(plain('P'), snapshot.position);
  assert.equal(run('t'), snapshot.t);
  assert.equal(run('MP.score'), 900);
  await run('savePlayer()');
  assert.equal(typeof writes.at(-1).progress, 'string', 'JSON conserva también los arrays vacíos en RTDB');
  assert.deepEqual(JSON.parse(writes.at(-1).progress).clonePositions, snapshot.clonePositions);

  run('PL=[]; MP.solved=2; MP.score=900; load(2); MP.lvT=serverNow(); win()');
  const score = run('MP.score');
  assert.equal(run('MP.solved'), 3);
  run('win()');
  assert.equal(run('MP.score'), score, 'un nivel no puede puntuar dos veces');
  context.completed = JSON.stringify({...snapshot, level: 2, state: 'win'});
  run('MP.pendingProgress=completed; startRun()');
  assert.equal(run('li'), 3, 'una victoria ya puntuada continúa en el siguiente nivel');
  assert.equal(run('state'), 'play');

  // Un jugador nuevo no hereda el nivel que estuviese practicando antes de entrar.
  writes.length = 0; remote = null;
  run('MP.run=false; MP.joined=false; MP.solved=0; MP.score=0; MP.seen=""; MT.startAt=null; load(20)');
  await run('join()');
  assert.equal(writes.length, 1);
  assert.equal('progress' in writes[0], false);
  run('PL=[]; startRun()');
  assert.equal(run('li'), 0);

  run('db=null; window.CHRONO_FIREBASE_CONFIG={}; MP.run=false');
  await run('join()');
  assert.match(run('MP.err'), /Firebase no está conectado/);
  console.log('behavior tests: OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
