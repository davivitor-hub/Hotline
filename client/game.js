const SERVER = "wss://hotline-m6gx.onrender.com";
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha:false, desynchronized:true });
const mapCanvas = document.getElementById("mapCanvas");
const mctx = mapCanvas.getContext("2d");
const menu = document.getElementById("menu");
const statusEl = document.getElementById("status");
const playBtn = document.getElementById("playBtn");
const playersEl = document.getElementById("players");
const weaponEl = document.getElementById("weapon");
const ammoEl = document.getElementById("ammo");
const stateEl = document.getElementById("state");
const hpFill = document.getElementById("hpFill");
const hpValue = document.getElementById("hpValue");
const pingEl = document.getElementById("ping");

let ws=null,myId=null,map=null,players={},weapons=[];
let connected=false,matchStarted=false,mapOpen=false;
let keys={},mouse={x:innerWidth/2,y:innerHeight/2,down:false};
let lastInput=0,lastPacket=performance.now(),lastPing=0,ping=0;
let previousPlayers={},visualPlayers={},lastPickup=false,lastDrop=false;
const dpr=()=>Math.min(window.devicePixelRatio||1,2);

function resize(){
  const ratio=dpr();
  canvas.width=Math.floor(innerWidth*ratio);canvas.height=Math.floor(innerHeight*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  mapCanvas.width=900;mapCanvas.height=600;
}
addEventListener("resize",resize);resize();

function connect(){
  if(ws&&(ws.readyState===0||ws.readyState===1))return;
  statusEl.textContent="Conectando ao servidor...";
  ws=new WebSocket(SERVER);
  ws.onopen=()=>{connected=true;statusEl.textContent="Conectado. Aguardando adversário...";send({type:"join"});};
  ws.onclose=()=>{connected=false;matchStarted=false;statusEl.textContent="Servidor desconectado. Clique para reconectar.";stateEl.textContent="DESCONECTADO";menu.style.display="grid";};
  ws.onerror=()=>statusEl.textContent="Falha de conexão. Confira o servidor.";
  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==="welcome")myId=m.id;
    if(m.type==="full")statusEl.textContent="Sala cheia (2 jogadores).";
    if(m.type==="map"){map=m.map;weapons=m.weapons||[];previousPlayers={};visualPlayers={};}
    if(m.type==="state"){
      const now=performance.now();
      previousPlayers=visualPlayers;
      visualPlayers=m.players||{};
      players=m.players||{};
      weapons=m.weapons||weapons;
      lastPacket=now;
      const me=players[myId];
      if(me){
        weaponEl.textContent=me.weapon?me.weapon.name:"MÃOS";
        ammoEl.textContent=me.weapon?`${me.weapon.ammo} / ${me.weapon.maxAmmo}`:"—";
        hpValue.textContent=`${Math.ceil(me.hp)} / 100`;
        hpFill.style.width=`${Math.max(0,me.hp)}%`;
        hpFill.classList.toggle("low",me.hp<=30);
        stateEl.textContent=me.alive?"EM COMBATE":"ELIMINADO";
      }
      playersEl.textContent=`${Object.keys(players).length}/2`;
      if(mapOpen)drawMap();
    }
    if(m.type==="start"){matchStarted=true;menu.style.display="none";stateEl.textContent="LUTE!";lastPacket=performance.now();}
    if(m.type==="message")statusEl.textContent=m.text;
    if(m.type==="hit"&&m.target===myId){stateEl.textContent=`ATINGIDO −${m.damage||0} HP`;flashDamage();}
    if(m.type==="round"){matchStarted=false;stateEl.textContent=m.winner===myId?"VITÓRIA!":"VOCÊ PERDEU";menu.style.display="grid";statusEl.textContent=m.winner===myId?"Você venceu! Nova rodada em instantes.":"Você foi eliminado. Nova rodada em instantes.";}
  };
}
function flashDamage(){document.body.classList.remove("damage-flash");void document.body.offsetWidth;document.body.classList.add("damage-flash");}
playBtn.onclick=()=>{connect();if(ws&&ws.readyState===1)send({type:"join"});};
connect();
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}

addEventListener("keydown",e=>{
  const key=e.key.toLowerCase();
  if(["w","a","s","d","e","q","r","f"," "].includes(key))e.preventDefault();
  if(key==="q"&&!e.repeat){mapOpen=!mapOpen;document.getElementById("mapOverlay").classList.toggle("open",mapOpen);if(mapOpen)drawMap();}
  if(key==="r"&&!e.repeat)send({type:"reload"});
  if(key==="f"&&!e.repeat)keys.f=true;
  keys[key]=true;
});
addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false;});
canvas.addEventListener("mousemove",e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
canvas.addEventListener("mousedown",e=>{if(e.button===0)mouse.down=true;if(e.button===2){e.preventDefault();keys.f=true;}});
addEventListener("mouseup",e=>{if(e.button===0)mouse.down=false;if(e.button===2)keys.f=false;});
canvas.addEventListener("contextmenu",e=>e.preventDefault());
function input(){
  if(!matchStarted||!myId)return;
  const me=players[myId];if(!me)return;
  const now=performance.now();if(now-lastInput<33)return;lastInput=now;
  const pickup=!!keys.e,drop=!!keys.f;
  const angle=Math.atan2(mouse.y-innerHeight/2,mouse.x-innerWidth/2);
  send({type:"input",keys:{w:!!keys.w,a:!!keys.a,s:!!keys.s,d:!!keys.d},angle,shoot:mouse.down,pickup:pickup&&!lastPickup,drop:drop&&!lastDrop});
  lastPickup=pickup;lastDrop=drop;
}
function smoothPlayer(id,p,now){
  if(id===myId)return p;
  const old=previousPlayers[id]||p;
  const t=Math.min(1,Math.max(0,(now-lastPacket+35)/50));
  return {...p,x:old.x+(p.x-old.x)*t,y:old.y+(p.y-old.y)*t,angle:p.angle};
}
function roundedRect(x,y,w,h,r,fill,stroke){
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function drawWeapon(w){
  const col=w.type==="SHOTGUN"?"#ffc96b":w.type==="RIFLE"?"#b9ff79":"#6bf4ff";
  ctx.save();ctx.translate(w.x,w.y);ctx.rotate(w.rot||0);
  ctx.shadowColor=col;ctx.shadowBlur=10;ctx.fillStyle=col;
  roundedRect(-13,-4,24,8,2,col);ctx.fillRect(5,-2,9,4);ctx.fillStyle="#17202b";ctx.fillRect(-5,3,7,4);
  ctx.restore();
}
function draw(){
  requestAnimationFrame(draw);input();
  const width=innerWidth,height=innerHeight,now=performance.now();
  ctx.clearRect(0,0,width,height);
  if(!map){ctx.fillStyle="#080b12";ctx.fillRect(0,0,width,height);return;}
  const me=players[myId],ox=me?me.x:map.width/2,oy=me?me.y:map.height/2;
  ctx.fillStyle="#0a0e16";ctx.fillRect(0,0,width,height);
  ctx.save();ctx.translate(Math.round(width/2-ox),Math.round(height/2-oy));
  ctx.fillStyle="#141c28";ctx.fillRect(0,0,map.width,map.height);
  // Piso em grade sutil
  ctx.strokeStyle="rgba(87,220,255,.075)";ctx.lineWidth=1;ctx.beginPath();
  const left=ox-width/2,top=oy-height/2;
  for(let x=Math.floor(left/80)*80;x<left+width+80;x+=80){ctx.moveTo(x,top-80);ctx.lineTo(x,top+height+80);}
  for(let y=Math.floor(top/80)*80;y<top+height+80;y+=80){ctx.moveTo(left-80,y);ctx.lineTo(left+width+80,y);}
  ctx.stroke();
  for(const r of map.walls){
    ctx.fillStyle="#080d15";ctx.fillRect(r.x,r.y,r.w,r.h);
    ctx.strokeStyle="#27394a";ctx.lineWidth=3;ctx.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);
    ctx.fillStyle="rgba(49,205,231,.07)";ctx.fillRect(r.x+5,r.y+5,Math.max(0,r.w-10),4);
  }
  for(const w of weapons){if(!w.taken)drawWeapon(w);}
  for(const id in players){
    const p=smoothPlayer(id,players[id],now);
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle||0);
    const col=id===myId?"#65f5ff":"#ff547c";
    ctx.shadowColor=col;ctx.shadowBlur=14;
    ctx.fillStyle="rgba(0,0,0,.45)";ctx.beginPath();ctx.ellipse(3,5,18,13,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,15,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;ctx.strokeStyle="#f6fbff";ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle="#0a1018";roundedRect(2,-5,23,10,3,"#0a1018");
    ctx.fillStyle="#f5ffff";ctx.fillRect(15,-2,10,4);
    // vida acima do personagem
    ctx.rotate(-(p.angle||0));ctx.fillStyle="#070a10";ctx.fillRect(-20,-29,40,5);
    ctx.fillStyle=p.hp<=30?"#ff496f":"#62f5a8";ctx.fillRect(-20,-29,40*Math.max(0,p.hp)/100,5);
    ctx.restore();
  }
  ctx.restore();
  // mira
  if(matchStarted){ctx.strokeStyle="#d9fbff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(mouse.x,mouse.y,8,0,Math.PI*2);ctx.moveTo(mouse.x-13,mouse.y);ctx.lineTo(mouse.x-4,mouse.y);ctx.moveTo(mouse.x+4,mouse.y);ctx.lineTo(mouse.x+13,mouse.y);ctx.moveTo(mouse.x,mouse.y-13);ctx.lineTo(mouse.x,mouse.y-4);ctx.moveTo(mouse.x,mouse.y+4);ctx.lineTo(mouse.x,mouse.y+13);ctx.stroke();}
  if(matchStarted&&performance.now()-lastPacket>1800)stateEl.textContent="REDE LENTA...";
}
draw();

function drawMap(){
  if(!map)return;
  const sx=mapCanvas.width/map.width,sy=mapCanvas.height/map.height;
  mctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);mctx.fillStyle="#111a26";mctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);
  for(const r of map.walls){mctx.fillStyle="#03070c";mctx.fillRect(r.x*sx,r.y*sy,r.w*sx,r.h*sy);}
  for(const w of weapons){if(!w.taken){mctx.fillStyle=w.type==="SHOTGUN"?"#ffc96b":w.type==="RIFLE"?"#b9ff79":"#6bf4ff";mctx.fillRect(w.x*sx-4,w.y*sy-3,8,6);}}
  for(const id in players){const p=players[id];mctx.fillStyle=id===myId?"#65f5ff":"#ff547c";mctx.beginPath();mctx.arc(p.x*sx,p.y*sy,7,0,Math.PI*2);mctx.fill();}
}
setInterval(()=>{if(mapOpen)drawMap();},150);
