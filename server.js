const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const W=1800, H=1000;
const MAX=2;
const clients=new Map();
let game=null;

function rnd(a,b){return Math.random()*(b-a)+a}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function rectHitCircle(r,x,y,rad){
  const cx=clamp(x,r.x,r.x+r.w), cy=clamp(y,r.y,r.y+r.h);
  return Math.hypot(x-cx,y-cy)<rad;
}
function freePoint(walls,rad=25){
  for(let i=0;i<1000;i++){
    const p={x:rnd(70,W-70),y:rnd(70,H-70)};
    if(walls.every(r=>!rectHitCircle(r,p.x,p.y,rad))) return p;
  }
  return {x:100,y:100};
}
function makeMap(){
  const walls=[];
  walls.push({x:0,y:0,w:W,h:30},{x:0,y:H-30,w:W,h:30},{x:0,y:0,w:30,h:H},{x:W-30,y:0,w:30,h:H});
  for(let i=0;i<22;i++){
    const w=rnd(100,300),h=rnd(50,150),x=rnd(70,W-w-70),y=rnd(70,H-h-70);
    const r={x,y,w,h};
    if(walls.slice(4).every(o=>Math.abs((o.x+o.w/2)-(x+w/2))>70||Math.abs((o.y+o.h/2)-(y+h/2))>70)) walls.push(r);
  }
  return {width:W,height:H,walls};
}
function makeGame(){
  const map=makeMap(), weapons=[];
  const types=[
    {name:"PISTOLA",damage:34,fireDelay:220,maxAmmo:12,speed:13,spread:.03},
    {name:"SHOTGUN",damage:22,fireDelay:650,maxAmmo:4,speed:12,spread:.25,pellets:7}
  ];
  for(let i=0;i<12;i++){
    const p=freePoint(map.walls,28), t=types[Math.floor(Math.random()*types.length)];
    weapons.push({id:crypto.randomUUID(),x:p.x,y:p.y,rot:rnd(0,Math.PI*2),type:t.name,stats:t,taken:false});
  }
  return {map,weapons,players:{}};
}
function spawn(p){
  const q=freePoint(game.map.walls,25);
  p.x=q.x;p.y=q.y;p.hp=100;p.alive=true;p.weapon=null;p.cool=0;
}
function makePlayer(id){
  const p={id,x:0,y:0,angle:0,hp:100,alive:true,weapon:null,cool:0};
  spawn(p); return p;
}
function collision(p,nx,ny){
  const r=22;
  if(nx<30+r||ny<30+r||nx>W-30-r||ny>H-30-r)return true;
  return game.map.walls.some(w=>rectHitCircle(w,nx,ny,r));
}
function broadcast(o){
  const s=JSON.stringify(o);
  for(const c of clients.values()) if(c.ws.readyState===WebSocket.OPEN)c.ws.send(s);
}
function publicState(){
  const out={};
  for(const [id,p] of Object.entries(game.players)){
    out[id]={id:p.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,alive:p.alive,
      weapon:p.weapon?{name:p.weapon.name,ammo:p.weapon.ammo,maxAmmo:p.weapon.maxAmmo}:null};
  }
  return out;
}
function resetRound(winner){
  broadcast({type:"round",winner});
  setTimeout(()=>{
    if(Object.keys(game.players).length<2)return;
    game=makeGame();
    for(const id of Object.keys(game.players)) game.players[id]=makePlayer(id);
    broadcast({type:"map",map:game.map,weapons:game.weapons});
    broadcast({type:"start"});
  },1200);
}
function shoot(p){
  const now=Date.now();
  if(!p.alive||!p.weapon||now<p.cool)return;
  if(p.weapon.ammo<=0)return;
  p.cool=now+p.weapon.fireDelay;p.weapon.ammo--;
  const count=p.weapon.pellets||1;
  for(let k=0;k<count;k++){
    const a=p.angle+rnd(-p.weapon.spread,p.weapon.spread);
    let x=p.x,y=p.y;
    for(let s=0;s<85;s++){
      x+=Math.cos(a)*4;y+=Math.sin(a)*4;
      if(collision(p,x,y))break;
      for(const q of Object.values(game.players)){
        if(q.id===p.id||!q.alive)continue;
        if(Math.hypot(q.x-x,q.y-y)<20){
          q.hp-=p.weapon.damage;
          broadcast({type:"hit",shooter:p.id,target:q.id});
          if(q.hp<=0){
            q.alive=false;
            broadcast({type:"state",players:publicState(),weapons:game.weapons});
            resetRound(p.id);
          }
          return;
        }
      }
    }
  }
}
function handle(ws,m){
  if(m.type==="join"){
    if(clients.size>MAX){ws.send(JSON.stringify({type:"full"}));return}
    const id=crypto.randomUUID();clients.set(ws,{id,ws});
    game.players[id]=makePlayer(id);
    ws.send(JSON.stringify({type:"welcome",id}));
    ws.send(JSON.stringify({type:"map",map:game.map,weapons:game.weapons}));
    if(clients.size===2){
      broadcast({type:"start"});
      broadcast({type:"message",text:"2 jogadores conectados — FIGHT!"});
    }
    return;
  }
  const c=clients.get(ws);if(!c)return;
  const p=game.players[c.id];if(!p)return;
  if(m.type==="input"){
    if(!p.alive)return;
    const k=m.keys||{}, speed=4.6;
    let dx=(k.d?1:0)-(k.a?1:0),dy=(k.s?1:0)-(k.w?1:0);
    if(dx||dy){const l=Math.hypot(dx,dy);dx/=l;dy/=l;let nx=p.x+dx*speed,ny=p.y+dy*speed;
      if(!collision(p,nx,p.y))p.x=nx;if(!collision(p,p.x,ny))p.y=ny;
    }
    if(Number.isFinite(m.angle))p.angle=m.angle;
    if(k.pickup){
      const w=game.weapons.find(w=>!w.taken&&Math.hypot(w.x-p.x,w.y-p.y)<55);
      if(w){w.taken=true;p.weapon={...w.stats,name:w.type,ammo:w.stats.maxAmmo,maxAmmo:w.stats.maxAmmo};}
    }
    if(m.shoot)shoot(p);
  }
  if(m.type==="reload"&&p.weapon)p.weapon.ammo=p.weapon.maxAmmo;
}
const server=http.createServer((req,res)=>{
  res.writeHead(200,{"Content-Type":"text/plain","Access-Control-Allow-Origin":"*"});
  res.end("NEON DUEL multiplayer server online");
});
const wss=new WebSocket.Server({server});
wss.on("connection",ws=>{
  if(clients.size>=MAX){ws.send(JSON.stringify({type:"full"}));ws.close();return}
  ws.on("message",d=>{try{handle(ws,JSON.parse(d.toString()))}catch(e){console.error(e)}});
  ws.on("close",()=>{
    const c=clients.get(ws);if(c){delete game.players[c.id];clients.delete(ws);broadcast({type:"message",text:"Jogador saiu."})}
  });
});
game=makeGame();
setInterval(()=>broadcast({type:"state",players:publicState(),weapons:game.weapons}),50);
server.listen(PORT,"0.0.0.0",()=>console.log("NEON DUEL server on "+PORT));
