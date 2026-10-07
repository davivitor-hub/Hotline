const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||10000,root=__dirname;
const server=http.createServer((req,res)=>{
 let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
 const file=path.resolve(root,'.'+p);
 if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('404')}
 const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
 res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({server});
const rooms=new Map();let nextId=1;
const TILE=40,MW=50,MH=30,MAPW=MW*TILE,MAPH=MH*TILE;
const WEAPONS={
 PISTOL:{ammo:12,rate:190,damage:25,speed:14,pellets:1,spread:.025},
 SMG:{ammo:36,rate:75,damage:11,speed:16,pellets:1,spread:.09},
 SHOTGUN:{ammo:6,rate:650,damage:14,speed:13,pellets:7,spread:.30}
};
function newSeed(){return (Date.now()^Math.floor(Math.random()*0xffffffff))>>>0}
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
function generate(seed){
 const r=rng(seed),map=Array.from({length:MH},()=>Array(MW).fill(1)),rooms=[];
 for(let i=0;i<18;i++){const w=5+Math.floor(r()*7),h=4+Math.floor(r()*5),x=1+Math.floor(r()*(MW-w-2)),y=1+Math.floor(r()*(MH-h-2));rooms.push({x,y,w,h});for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)map[yy][xx]=0}
 rooms.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
 for(let i=1;i<rooms.length;i++){const a=rooms[i-1],b=rooms[i],x1=Math.floor(a.x+a.w/2),y1=Math.floor(a.y+a.h/2),x2=Math.floor(b.x+b.w/2),y2=Math.floor(b.y+b.h/2);
  if(r()>.5){for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)map[y1][x]=0;for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)map[y][x2]=0}
  else{for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)map[y][x1]=0;for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)map[y2][x]=0}}
 const points=rooms.map(a=>({x:(a.x+a.w/2)*TILE,y:(a.y+a.h/2)*TILE}));
 // Muitas armas em posições diferentes: a cada sala pode aparecer uma arma.
 const types=['PISTOL','SMG','SHOTGUN','SMG','PISTOL','SHOTGUN','SMG','PISTOL','SHOTGUN'];
 const weapons=types.map((type,i)=>{const p=points[(i*2+1)%points.length];return{x:p.x+(r()-.5)*60,y:p.y+(r()-.5)*45,type,ammo:WEAPONS[type].ammo,id:'w'+i}});
 return {map,points,weapons};
}
function makeRoom(){
 for(const r of rooms.values())if(r.players.size<2)return r;
 const id=String(Math.floor(1000+Math.random()*9000)),seed=newSeed(),g=generate(seed);
 const r={id,seed,map:g.map,points:g.points,weapons:g.weapons,players:new Map(),bullets:[],winner:null,ended:false};
 rooms.set(id,r);return r;
}
function send(ws,o){if(ws.readyState===1)ws.send(JSON.stringify(o))}
function broadcast(r,o){for(const p of r.players.values())send(p.ws,o)}
function walk(r,x,y,rad=13){
 const minx=Math.floor((x-rad)/TILE),maxx=Math.floor((x+rad)/TILE),miny=Math.floor((y-rad)/TILE),maxy=Math.floor((y+rad)/TILE);
 for(let yy=miny;yy<=maxy;yy++)for(let xx=minx;xx<=maxx;xx++)if(yy<0||xx<0||yy>=MH||xx>=MW||r.map[yy][xx])return false;return true
}
function spawnFor(r,index){
 const p=r.points[index%r.points.length];
 const candidates=[p,...r.points.filter(q=>Math.hypot(q.x-p.x,q.y-p.y)>180)];
 for(const q of candidates)if(walk(r,q.x,q.y))return{x:q.x,y:q.y};return{x:100,y:100}
}
function snapshot(r){
 return {type:'state',seed:r.seed,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,weapon:p.weapon,ammo:p.ammo,alive:p.alive})).reduce((o,p)=>(o[p.id]=p,o),{}),bullets:r.bullets.map(b=>({x:b.x,y:b.y,owner:b.owner})),weapons:r.weapons}
}
function resetRound(r){
 const g=generate(newSeed());r.seed=Date.now()>>>0;r.map=g.map;r.points=g.points;r.weapons=g.weapons;r.bullets=[];r.winner=null;r.ended=false;
 [...r.players.values()].forEach((p,i)=>{const s=spawnFor(r,i);p.x=s.x;p.y=s.y;p.hp=100;p.alive=true;p.weapon='PISTOL';p.ammo=12;p.dx=0;p.dy=0});
 broadcast(r,{type:'round'});broadcast(r,snapshot(r));
}
function fire(r,p,angle){
 const w=WEAPONS[p.weapon];if(!w||!p.alive||p.ammo<=0)return;
 const now=Date.now();if(now-p.lastShot<w.rate)return;p.lastShot=now;p.ammo--;
 for(let i=0;i<w.pellets;i++){const a=angle+(Math.random()-.5)*w.spread;r.bullets.push({x:p.x,y:p.y,vx:Math.cos(a)*w.speed,vy:Math.sin(a)*w.speed,owner:p.id,damage:w.damage,life:70})}
}
function tick(r){
 const ps=[...r.players.values()];
 for(const p of ps)if(p.alive){const nx=p.x+p.dx*4,ny=p.y+p.dy*4;if(walk(r,nx,p.y))p.x=nx;if(walk(r,p.x,ny))p.y=ny}
 for(const b of r.bullets){
  b.x+=b.vx;b.y+=b.vy;b.life--;if(!walk(r,b.x,b.y,2))b.life=0;
  for(const p of ps)if(b.life>0&&p.id!==b.owner&&p.alive&&Math.hypot(p.x-b.x,p.y-b.y)<17){
   p.hp-=b.damage;b.life=0;
   if(p.hp<=0){p.hp=0;p.alive=false;r.winner=b.owner;r.ended=true;const winner=r.players.get(b.owner);broadcast(r,{type:'dead',winnerId:b.owner,text:(winner?.name||'Jogador')+' venceu a rodada.'})}
  }
 }
 r.bullets=r.bullets.filter(b=>b.life>0);broadcast(r,snapshot(r));
}
setInterval(()=>{for(const r of rooms.values())if(r.players.size)tick(r)},33);
wss.on('connection',ws=>{
 let p=null,r=null;
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='join'){
   if(p)return;r=makeRoom();const s=spawnFor(r,r.players.size);
   p={id:String(nextId++),name:String(m.name||'Player').slice(0,14),x:s.x,y:s.y,dx:0,dy:0,angle:0,hp:100,weapon:'PISTOL',ammo:12,lastShot:0,alive:true,ws};
   r.players.set(p.id,p);send(ws,{type:'welcome',id:p.id,room:r.id,seed:r.seed,weapons:r.weapons});broadcast(r,{type:'event',text:p.name+' entrou na arena'});broadcast(r,snapshot(r));
  }else if(!p||!r)return;
  else if(m.type==='input'){p.dx=Math.max(-1,Math.min(1,Number(m.dx)||0));p.dy=Math.max(-1,Math.min(1,Number(m.dy)||0));p.angle=Number(m.angle)||0}
  else if(m.type==='shoot')fire(r,p,Number(m.angle)||0);
  else if(m.type==='pickup'&&p.alive){const i=r.weapons.findIndex(w=>Math.hypot(w.x-p.x,w.y-p.y)<42);if(i>=0){const w=r.weapons.splice(i,1)[0];p.weapon=w.type;p.ammo=w.ammo;broadcast(r,{type:'event',text:p.name+' pegou '+w.type})}}
  else if(m.type==='ping')send(ws,{type:'pong',t:Number(m.t)||0});
  else if(m.type==='pause'){}
  else if(m.type==='rematch'&&r.ended)resetRound(r);
 });
 ws.on('close',()=>{if(r&&p){r.players.delete(p.id);broadcast(r,{type:'event',text:p.name+' saiu da arena'});if(r.players.size===0)rooms.delete(r.id)}})
});
server.listen(PORT,()=>console.log('2 SHADOWS server listening on '+PORT));