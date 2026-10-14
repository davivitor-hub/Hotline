const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const W = 1800, H = 1000, MAX_PLAYERS = 2;
const clients = new Map();
let game;
const weaponTypes = {
  PISTOLA: { name:"PISTOLA", damage:34, fireDelay:220, maxAmmo:12, spread:0.035, pellets:1, color:"#65f5ff" },
  SHOTGUN: { name:"SHOTGUN", damage:16, fireDelay:620, maxAmmo:5, spread:0.24, pellets:7, color:"#ffcc66" },
  RIFLE: { name:"RIFLE", damage:20, fireDelay:105, maxAmmo:28, spread:0.075, pellets:1, color:"#b6ff79" }
};
const rnd = (a,b) => Math.random()*(b-a)+a;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
function rectHitCircle(r,x,y,rad) {
  const cx=clamp(x,r.x,r.x+r.w), cy=clamp(y,r.y,r.y+r.h);
  return Math.hypot(x-cx,y-cy)<rad;
}
function freePoint(walls,rad=25) {
  for(let i=0;i<1200;i++) {
    const p={x:rnd(65,W-65),y:rnd(65,H-65)};
    if(walls.every(r=>!rectHitCircle(r,p.x,p.y,rad))) return p;
  }
  return {x:100,y:100};
}
function makeMap() {
  const walls=[
    {x:0,y:0,w:W,h:30},{x:0,y:H-30,w:W,h:30},
    {x:0,y:0,w:30,h:H},{x:W-30,y:0,w:30,h:H}
  ];
  for(let i=0;i<22;i++) {
    const w=rnd(100,260),h=rnd(55,135),x=rnd(70,W-w-70),y=rnd(70,H-h-70);
    const r={x,y,w,h};
    if(walls.slice(4).every(o=>Math.abs((o.x+o.w/2)-(x+w/2))>80 || Math.abs((o.y+o.h/2)-(y+h/2))>80)) walls.push(r);
  }
  return {width:W,height:H,walls};
}
function makeWeapon(type,x,y,ammo) {
  const t=weaponTypes[type] || weaponTypes.PISTOLA;
  return {id:crypto.randomUUID(),x,y,rot:rnd(0,Math.PI*2),type:t.name,stats:{...t},ammo:ammo ?? t.maxAmmo,taken:false};
}
function makeGame() {
  const map=makeMap(), weapons=[];
  for(let i=0;i<14;i++) {
    const p=freePoint(map.walls,26), type=["PISTOLA","PISTOLA","SHOTGUN","RIFLE"][Math.floor(Math.random()*4)];
    weapons.push(makeWeapon(type,p.x,p.y));
  }
  return {map,weapons,players:{}};
}
function spawn(p) {
  const q=freePoint(game.map.walls,25);
  Object.assign(p,{x:q.x,y:q.y,angle:0,hp:100,alive:true,weapon:null,cool:0});
}
function makePlayer(id) { const p={id,x:0,y:0,angle:0,hp:100,alive:true,weapon:null,cool:0};spawn(p);return p; }
function collision(p,nx,ny) {
  const r=20;
  if(nx<30+r||ny<30+r||nx>W-30-r||ny>H-30-r)return true;
  return game.map.walls.some(w=>rectHitCircle(w,nx,ny,r));
}
function broadcast(o) {
  const s=JSON.stringify(o);
  for(const c of clients.values()) if(c.ws.readyState===WebSocket.OPEN)c.ws.send(s);
}
function publicWeapons() { return game.weapons.map(({stats,...w})=>({...w,stats:undefined})); }
function publicState() {
  const out={};
  for(const [id,p] of Object.entries(game.players)) out[id]={
    id:p.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,alive:p.alive,
    weapon:p.weapon?{name:p.weapon.name,ammo:p.weapon.ammo,maxAmmo:p.weapon.maxAmmo}:null
  };
  return out;
}
function sendState() { broadcast({type:"state",players:publicState(),weapons:publicWeapons()}); }
function dropWeapon(p) {
  if(!p.weapon)return;
  const w=makeWeapon(p.weapon.name,p.x+Math.cos(p.angle)*30,p.y+Math.sin(p.angle)*30,p.weapon.ammo);
  w.rot=p.angle;
  game.weapons.push(w);
  p.weapon=null;
}
function resetRound(winner) {
  if(game.resetting)return;
  game.resetting=true;
  broadcast({type:"round",winner});
  setTimeout(()=>{
    if(Object.keys(game.players).length<2){game.resetting=false;return;}
    game=makeGame();
    for(const id of Object.keys(game.players))game.players[id]=makePlayer(id);
    broadcast({type:"map",map:game.map,weapons:publicWeapons()});
    broadcast({type:"start"});
  },1800);
}
function shoot(p) {
  const now=Date.now();
  if(!p.alive||!p.weapon||now<p.cool||p.weapon.ammo<=0)return;
  p.cool=now+p.weapon.fireDelay;p.weapon.ammo--;
  const count=p.weapon.pellets||1;
  for(let k=0;k<count;k++) {
    const a=p.angle+rnd(-p.weapon.spread,p.weapon.spread);
    let hit=false;
    for(let s=0;s<100;s++) {
      const x=p.x+Math.cos(a)*s*5, y=p.y+Math.sin(a)*s*5;
      if(collision(p,x,y))break;
      for(const q of Object.values(game.players)) {
        if(q.id===p.id||!q.alive)continue;
        if(Math.hypot(q.x-x,q.y-y)<21) {
          q.hp=Math.max(0,q.hp-p.weapon.damage);
          broadcast({type:"hit",shooter:p.id,target:q.id,damage:p.weapon.damage,hp:q.hp});
          if(q.hp<=0){q.alive=false;resetRound(p.id);}
          hit=true;break;
        }
      }
      if(hit)break;
    }
  }
}
function pickup(p) {
  let best=-1, bestD=58;
  for(let i=0;i<game.weapons.length;i++) {
    const w=game.weapons[i], d=Math.hypot(w.x-p.x,w.y-p.y);
    if(!w.taken&&d<bestD){best=i;bestD=d;}
  }
  if(best<0)return;
  const w=game.weapons[best];
  if(p.weapon)dropWeapon(p);
  p.weapon={...weaponTypes[w.type],name:w.type,ammo:w.ammo,maxAmmo:weaponTypes[w.type].maxAmmo};
  game.weapons.splice(best,1);
  broadcast({type:"message",text:`${p.weapon.name} equipada`});
}
function handle(ws,m) {
  if(!m||typeof m.type!=="string")return;
  if(m.type==="join") {
    const existing=clients.get(ws);
    if(existing){ws.send(JSON.stringify({type:"welcome",id:existing.id}));return;}
    if(clients.size>=MAX_PLAYERS){ws.send(JSON.stringify({type:"full"}));return;}
    const id=crypto.randomUUID();
    clients.set(ws,{id,ws,lastInput:0});
    game.players[id]=makePlayer(id);
    ws.send(JSON.stringify({type:"welcome",id}));
    ws.send(JSON.stringify({type:"map",map:game.map,weapons:publicWeapons()}));
    sendState();
    if(clients.size===2){broadcast({type:"start"});broadcast({type:"message",text:"2 jogadores conectados — FIGHT!"});}
    return;
  }
  const c=clients.get(ws); if(!c)return;
  const p=game.players[c.id]; if(!p)return;
  if(m.type==="input") {
    if(!p.alive||game.resetting)return;
    const now=Date.now();
    if(now-c.lastInput<20)return;
    const dt=Math.min(40,now-c.lastInput||33);c.lastInput=now;
    const k=m.keys||{}, speed=0.19*dt;
    let dx=(k.d?1:0)-(k.a?1:0),dy=(k.s?1:0)-(k.w?1:0);
    if(dx||dy){const l=Math.hypot(dx,dy);dx/=l;dy/=l;
      const nx=p.x+dx*speed,ny=p.y+dy*speed;
      if(!collision(p,nx,p.y))p.x=nx;
      if(!collision(p,p.x,ny))p.y=ny;
    }
    if(Number.isFinite(m.angle))p.angle=m.angle;
    if(m.pickup&&!c.pickupDown)pickup(p);
    if(m.drop&&!c.dropDown)dropWeapon(p);
    if(m.shoot)shoot(p);
    c.pickupDown=!!m.pickup;c.dropDown=!!m.drop;
  }
  if(m.type==="reload"&&p.weapon&&p.alive) p.weapon.ammo=p.weapon.maxAmmo;
}
const server=http.createServer((req,res)=>{
  res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
  res.end("NEON DUEL — servidor online");
});
const wss=new WebSocket.Server({server});
wss.on("connection",ws=>{
  if(clients.size>=MAX_PLAYERS){ws.send(JSON.stringify({type:"full"}));ws.close();return;}
  ws.on("message",d=>{try{handle(ws,JSON.parse(d.toString()));}catch(e){console.error("Mensagem inválida:",e.message);}});
  ws.on("close",()=>{
    const c=clients.get(ws);
    if(c){delete game.players[c.id];clients.delete(ws);broadcast({type:"message",text:"Jogador saiu."});sendState();}
  });
});
game=makeGame();
setInterval(()=>{if(game&&!game.resetting)sendState();},50);
server.listen(PORT,"0.0.0.0",()=>console.log("NEON DUEL server on "+PORT));
