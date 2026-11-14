const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const project = 'demo-chrono-shift';
const base = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const ns = `${project}-default-rtdb`;
function token(uid) {
  const now = Math.floor(Date.now()/1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({alg:'none',typ:'JWT'})}.${b64({iss:`https://securetoken.google.com/${project}`,aud:project,auth_time:now,user_id:uid,sub:uid,iat:now,exp:now+3600,firebase:{identities:{},sign_in_provider:'anonymous'}})}.`;
}
async function request(route, method='GET', data, auth) {
  const url = new URL(`${base}/${route}.json`); url.searchParams.set('ns', ns);
  if (auth && auth !== 'owner') url.searchParams.set('auth', token(auth));
  const headers = {'Content-Type':'application/json'};
  if (auth === 'owner') headers.Authorization = 'Bearer owner';
  const response = await fetch(url, {method, headers, body: data === undefined ? undefined : JSON.stringify(data)});
  const text = await response.text();
  return {status: response.status, data: text ? JSON.parse(text) : null};
}
(async () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase.rules.json'),'utf8'));
  assert.equal((await request('.settings/rules','PUT',rules,'owner')).status,200,'reglas deben compilar en RTDB');
  assert.equal((await request('','PUT',{admins:{admin1:true}},'owner')).status,200);
  assert.notEqual((await request('match/state','PUT',{},undefined)).status,200,'anónimo sin auth no puede escribir');
  assert.notEqual((await request('admins/player1','PUT',true,'player1')).status,200,'nadie puede autoasignarse rol');
  const match = {id:'m1',code:'A7K2Q9',ban:[],settings:{durationSec:900,countdownSec:8,maxPlayers:30}};
  assert.notEqual((await request('match/state','PUT',match,'player1')).status,200,'jugador no puede gestionar partida');
  assert.equal((await request('match/state','PUT',match,'admin1')).status,200,'admin sí puede crear partida con ban vacío');
  const player = {name:'Joan',matchId:'m1',solved:0,score:0,t:Date.now(),progress:JSON.stringify({level:0,moves:[],clones:[],blocks:[]})};
  assert.equal((await request('players/player1','PUT',player,'player1')).status,200,'jugador guarda nodo propio');
  assert.equal((await request('players','GET',undefined,'player1')).status,200,'ranking se lee desde el nodo padre');
  assert.notEqual((await request('players/player2','PUT',player,'player1')).status,200,'no puede sobrescribir a otro');
  assert.notEqual((await request('players/player1/score','PUT',-1,'player1')).status,200,'rechaza score negativo');
  assert.equal((await request('players/player1','GET',undefined,'player1')).data.progress,player.progress,'arrays vacíos sobreviven la persistencia');
  assert.equal((await request('players/player1','DELETE',undefined,'admin1')).status,200,'admin puede expulsar');
  assert.notEqual((await request('admins','GET',undefined,'player1')).status,200,'roles no se enumeran públicamente');
  console.log('RTDB emulator tests: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
