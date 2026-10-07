const canvas=document.getElementById('gameCanvas'),ctx=canvas.getContext('2d');
const mini=document.getElementById('miniCanvas'),mctx=mini.getContext('2d');
const W=1000,H=600,TILE=40,MW=50,MH=30,MAPW=MW*TILE,MAPH=MH*TILE;
const RENDER='wss://hotline-m6gx.onrender.com';
const WEAPONS={
 PISTOL:{name:'PISTOLA',ammo:12,rate:190,damage:25,speed:14,pellets:1,spread:.025},
 SMG:{name:'SMG',ammo:36,rate:75,damage:11,speed:16,pellets:1,spread:.09},
 SHOTGUN:{name:'ESCOPETA',ammo:6,rate:650,damage:14,speed:13,pellets:7,spread:.30}
};
let state='MENU',paused=false,showMini=false,keys={},mouse={x:500,y:300,down:false};
let map=[],weapons=[],bullets=[],players={},me=null,other=null,seed=0,playerId=null,roomId='----',ws=null;
let camera={x:0,y:0},last=performance.now(),lastInput=0,lastShot=0,lastPing=0,pingAt=0;
let toastTimer=0;

function resize(){canvas.width=W;canvas.height=H} resize(); addEventListener('resize',resize);
function $(id){return document.getElementById(id)}
function toast(t){$('toast').textContent=t;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),1100)}
function screen(id,on){$(id).classList.toggle('hidden',!on)}
function rngFactory(s){let x=s>>>0;return()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296}}
function generateMap(s){
 seed=s>>>0;const r=rngFactory(seed);map=Array.from({length:MH},()=>Array(MW).fill(1));const rooms=[];
 for(let i=0;i<18;i++){const w=5+Math.floor(r()*7),h=4+Math.floor(r()*5),x=1+Math.floor(r()*(MW-w-2)),y=1+Math.floor(r()*(MH-h-2));rooms.push({x,y,w,h});for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)map[yy][xx]=0}
 rooms.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
 for(let i=1;i<rooms.length;i++){const a=rooms[i-1],b=rooms[i],x1=Math.floor(a.x+a.w/2),y1=Math.floor(a.y+a.h/2),x2=Math.floor(b.x+b.w/2),y2=Math.floor(b.y+b.h/2);
  if(r()>.5){for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)map[y1][x]=0;for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)map[y][x2]=0}
  else{for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)map[y][x1]=0;for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++)map[y2][x]=0}}
}
function walkable(x,y,rad=13){
 const minx=Math.floor((x-rad)/TILE),maxx=Math.floor((x+rad)/TILE),miny=Math.floor((y-rad)/TILE),maxy=Math.floor((y+rad)/TILE);
 for(let yy=miny;yy<=maxy;yy++)for(let xx=minx;xx<=maxx;xx++)if(yy<0||xx<0||yy>=MH||xx>=MW||map[yy][xx])return false;return true;
}
function aimWorld(){
 if(!me)return 0;return Math.atan2(mouse.y+camera.y-me.y,mouse.x+camera.x-me.x)
}
function connect(){
 $('status').textContent='CONECTANDO...';$('roomInfoMenu').textContent='Conectando ao Render...';
 try{ws=new WebSocket(RENDER)}catch(e){toast('Falha ao abrir conexão');return}
 ws.onopen=()=>{ $('status').textContent='ONLINE';$('roomInfoMenu').textContent='Procurando jogador 2...'; send({type:'join',name:$('nameInput').value.trim()||'Player'}); pingAt=performance.now();send({type:'ping',t:pingAt}) };
 ws.onclose=()=>{ $('status').textContent='OFFLINE'; if(state==='PLAYING')toast('Servidor desconectado'); };
 ws.onerror=()=>toast('Erro de conexão');
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
}
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function handle(m){
 if(m.type==='welcome'){playerId=m.id;roomId=m.room;generateMap(m.seed);weapons=m.weapons||[];state='PLAYING';screen('mainMenu',false);screen('pauseMenu',false);$('hud').classList.remove('hidden');$('roomInfo').textContent='SALA '+roomId; $('roomInfoMenu').textContent='';}
 else if(m.type==='state'){players=m.players||{};me=players[playerId]||null;other=Object.values(players).find(p=>p.id!==playerId)||null;bullets=m.bullets||[];weapons=m.weapons||weapons;if(m.seed!==seed)generateMap(m.seed);updateHud()}
 else if(m.type==='event')toast(m.text||'');
 else if(m.type==='pong'){if(m.t)lastPing=Math.max(0,performance.now()-m.t);$('ping').textContent=Math.round(lastPing)+' ms'}
 else if(m.type==='dead'){state='GAMEOVER';$('resultTitle').textContent=m.winnerId===playerId?'VOCÊ VENCEU':'VOCÊ PERDEU';$('resultText').textContent=m.text||'';screen('gameOver',true)}
 else if(m.type==='round'){state='PLAYING';screen('gameOver',false);toast('NOVA ARENA')}
}
function updateHud(){
 if(!me)return;
 $('hp').textContent=Math.max(0,Math.round(me.hp))+' HP';$('weapon').textContent=me.weapon;
 const max=WEAPONS[me.weapon]?.ammo||12;$('ammo').textContent=me.ammo+' / '+max;
 $('enemyHp').textContent=other?Math.max(0,Math.round(other.hp))+' HP':'Aguardando';
 $('roomInfo').textContent='SALA '+roomId;
}
function shoot(){
 if(!me||paused||state!=='PLAYING')return;
 const w=WEAPONS[me.weapon]||WEAPONS.PISTOL,now=performance.now();
 if(now-lastShot<w.rate||me.ammo<=0)return;lastShot=now;send({type:'shoot',angle:aimWorld()});
}
function pickup(){if(me&&!paused)send({type:'pickup'})}
function toggleMap(){showMini=!showMini;$('minimap').classList.toggle('hidden',!showMini)}
function togglePause(){if(state!=='PLAYING')return;paused=!paused;screen('pauseMenu',paused);send({type:'pause',paused})}

function drawMap(){
 ctx.fillStyle='#05060a';ctx.fillRect(0,0,W,H);
 const sx=Math.floor(camera.x/TILE),ex=Math.ceil((camera.x+W)/TILE),sy=Math.floor(camera.y/TILE),ey=Math.ceil((camera.y+H)/TILE);
 for(let y=Math.max(0,sy);y<Math.min(MH,ey);y++)for(let x=Math.max(0,sx);x<Math.min(MW,ex);x++){
  const px=x*TILE-camera.x,py=y*TILE-camera.y;
  if(map[y][x]){ctx.fillStyle='#171b25';ctx.fillRect(px,py,TILE,TILE);ctx.strokeStyle='#222938';ctx.strokeRect(px+.5,py+.5,TILE-1,TILE-1)}
  else{ctx.fillStyle='#080b11';ctx.fillRect(px,py,TILE,TILE)}
 }
}
function drawWeapon(w){
 const x=w.x-camera.x,y=w.y-camera.y;if(x<-50||y<-50||x>W+50||y>H+50)return;
 ctx.save();ctx.translate(x,y);ctx.rotate(-.35);ctx.fillStyle=w.type==='SHOTGUN'?'#ffd45c':w.type==='SMG'?'#69dfff':'#f3f3f3';ctx.fillRect(-12,-3,24,6);ctx.fillRect(-4,3,7,7);ctx.restore();
}
function drawPlayer(p,local){
 if(!p)return;const x=p.x-camera.x,y=p.y-camera.y;ctx.save();ctx.translate(x,y);ctx.rotate(p.angle||0);
 ctx.fillStyle=local?'#00e5ff':'#ff287d';ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#111';ctx.fillRect(6,-3,20,6);ctx.restore();
 if(!local&&p.name){ctx.font='10px Arial';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(p.name,x,y-20)}
}
function render(){
 drawMap();weapons.forEach(drawWeapon);
 for(const b of bullets){const x=b.x-camera.x,y=b.y-camera.y;if(x<0||y<0||x>W||y>H)continue;ctx.fillStyle=b.owner===playerId?'#00e5ff':'#ff536f';ctx.beginPath();ctx.arc(x,y,3,0,7);ctx.fill()}
 drawPlayer(other,false);drawPlayer(me,true);
 drawMinimap();
}
function drawMinimap(){
 if(!showMini||!me)return;mctx.clearRect(0,0,mini.width,mini.height);mctx.fillStyle='#05070b';mctx.fillRect(0,0,mini.width,mini.height);
 const sx=mini.width/MAPW,sy=mini.height/MAPH;
 for(let y=0;y<MH;y++)for(let x=0;x<MW;x++)if(!map[y][x]){mctx.fillStyle='#252b38';mctx.fillRect(x*TILE*sx,y*TILE*sy,TILE*sx+1,TILE*sy+1)}
 for(const w of weapons){mctx.fillStyle='#ffd45c';mctx.fillRect(w.x*sx-2,w.y*sy-2,4,4)}
 if(other){mctx.fillStyle='#ff287d';mctx.beginPath();mctx.arc(other.x*sx,other.y*sy,4,0,7);mctx.fill()}
 mctx.fillStyle='#00e5ff';mctx.beginPath();mctx.arc(me.x*sx,me.y*sy,4,0,7);mctx.fill();
}
function updateCamera(){
 if(!me)return;camera.x=Math.max(0,Math.min(MAPW-W,me.x-W/2));camera.y=Math.max(0,Math.min(MAPH-H,me.y-H/2));
}
function loop(now){
 const dt=Math.min(50,now-last);last=now;
 if(state==='PLAYING'&&!paused&&me){
  const dx=(keys.d?1:0)-(keys.a?1:0),dy=(keys.s?1:0)-(keys.w?1:0);let nx=dx,ny=dy;
  if(nx||ny){const n=Math.hypot(nx,ny);nx/=n;ny/=n}
  const angle=aimWorld();
  // Previsão local: responde imediatamente; o servidor continua autoritativo.
  if(nx||ny){const speed=4;const px=me.x+nx*speed,py=me.y+ny*speed;if(walkable(px,me.y))me.x=px;if(walkable(me.x,py))me.y=py}
  me.angle=angle;updateCamera();
  if(now-lastInput>=33){lastInput=now;send({type:'input',dx:nx,dy:ny,angle})}
  if(mouse.down)shoot();
 } else updateCamera();
 render();requestAnimationFrame(loop)
}
addEventListener('keydown',e=>{
 if(e.target.matches('input'))return;
 const k=e.key.toLowerCase();if(k==='escape'){e.preventDefault();togglePause();return}if(k==='e'){e.preventDefault();pickup();return}if(k==='q'){e.preventDefault();toggleMap();return}keys[k]=true
});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)*W/r.width;mouse.y=(e.clientY-r.top)*H/r.height});
canvas.addEventListener('mousedown',e=>{if(e.button===0){mouse.down=true;shoot()}});
addEventListener('mouseup',e=>{if(e.button===0)mouse.down=false});
$('playBtn').onclick=()=>{if(!ws||ws.readyState>1)connect();else send({type:'join',name:$('nameInput').value.trim()||'Player'})};
$('mapBtn').onclick=toggleMap;$('resumeBtn').onclick=togglePause;
$('leaveBtn').onclick=()=>{if(ws)ws.close();location.reload()};
$('againBtn').onclick=()=>{if(ws&&ws.readyState===1)send({type:'rematch'});else location.reload()};
requestAnimationFrame(loop);
