const SERVER = "wss://hotline-m6gx.onrender.com";
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const mapCanvas = document.getElementById("mapCanvas");
const mctx = mapCanvas.getContext("2d");
const menu = document.getElementById("menu");
const statusEl = document.getElementById("status");
const playBtn = document.getElementById("playBtn");
const playersEl = document.getElementById("players");
const weaponEl = document.getElementById("weapon");
const ammoEl = document.getElementById("ammo");
const stateEl = document.getElementById("state");

let ws = null, myId = null, map = null, players = {}, weapons = [];
let connected = false, matchStarted = false, mapOpen = false;
let keys = {}, mouse = {x:0,y:0,down:false};
let lastInput = 0;

function resize(){
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  mapCanvas.width = 900; mapCanvas.height = 600;
}
addEventListener("resize",resize); resize();

function connect(){
  if(ws && (ws.readyState===0 || ws.readyState===1)) return;
  statusEl.textContent = "Conectando...";
  ws = new WebSocket(SERVER);
  ws.onopen = ()=>{
    connected=true;
    statusEl.textContent="Conectado. Aguardando adversário...";
    send({type:"join"});
  };
  ws.onclose = ()=>{
    connected=false;
    statusEl.textContent="Servidor desconectado. Clique para reconectar.";
    stateEl.textContent="DESCONECTADO";
  };
  ws.onerror = ()=> statusEl.textContent="Não foi possível conectar ao Render.";
  ws.onmessage = e=>{
    let m; try{m=JSON.parse(e.data)}catch{return}
    if(m.type==="welcome"){ myId=m.id; }
    if(m.type==="full"){ statusEl.textContent="Sala cheia (2 jogadores)."; }
    if(m.type==="map"){ map=m.map; weapons=m.weapons||[]; }
    if(m.type==="state"){
      players=m.players||{};
      weapons=m.weapons||weapons;
      if(m.map) map=m.map;
      const me=players[myId];
      if(me){ weaponEl.textContent=me.weapon ? me.weapon.name : "Mãos"; ammoEl.textContent=me.weapon ? `${me.weapon.ammo}/${me.weapon.maxAmmo}` : "0"; }
      playersEl.textContent=`${Object.keys(players).length}/2`;
    }
    if(m.type==="start"){
      matchStarted=true; menu.style.display="none"; stateEl.textContent="FIGHT!";
    }
    if(m.type==="message") statusEl.textContent=m.text;
    if(m.type==="hit" && m.target===myId) stateEl.textContent="VOCÊ FOI ATINGIDO";
    if(m.type==="round"){ stateEl.textContent=m.winner===myId?"VOCÊ VENCEU!":"VOCÊ PERDEU!"; }
  };
}
playBtn.onclick=()=>{connect(); if(connected) send({type:"join"});};
connect();

function send(o){ if(ws && ws.readyState===1) ws.send(JSON.stringify(o)); }

addEventListener("keydown",e=>{
  keys[e.key.toLowerCase()]=true;
  if(e.key.toLowerCase()==="q"){mapOpen=!mapOpen;document.getElementById("mapOverlay").classList.toggle("open",mapOpen);drawMap();}
  if(["w","a","s","d","e","q"].includes(e.key.toLowerCase())) e.preventDefault();
});
addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener("mousemove",e=>{mouse.x=e.clientX;mouse.y=e.clientY});
canvas.addEventListener("mousedown",e=>{if(e.button===0)mouse.down=true});
addEventListener("mouseup",e=>{if(e.button===0)mouse.down=false});

function input(){
  if(!matchStarted || !myId) return;
  const me=players[myId];
  if(!me) return;
  const sx=canvas.width/devicePixelRatio/2, sy=canvas.height/devicePixelRatio/2;
  const angle=Math.atan2(mouse.y-sy,mouse.x-sx);
  const now=performance.now();
  if(now-lastInput<45) return;
  lastInput=now;
  send({type:"input",keys:{w:!!keys.w,a:!!keys.a,s:!!keys.s,d:!!keys.d},angle,shoot:mouse.down,pickup:!!keys.e});
}

function worldToScreen(x,y){
  const me=players[myId];
  const sx=innerWidth/2, sy=innerHeight/2;
  return [sx+(x-(me?me.x:0)),sy+(y-(me?me.y:0))];
}

function draw(){
  requestAnimationFrame(draw);
  input();
  ctx.clearRect(0,0,innerWidth,innerHeight);
  if(!map){ctx.fillStyle="#151515";ctx.fillRect(0,0,innerWidth,innerHeight);return}
  const me=players[myId];
  const ox=me?me.x:map.width/2, oy=me?me.y:map.height/2;

  ctx.save(); ctx.translate(innerWidth/2-ox,innerHeight/2-oy);
  ctx.fillStyle="#202020";ctx.fillRect(0,0,map.width,map.height);

  for(const r of map.walls){
    ctx.fillStyle="#080808";ctx.fillRect(r.x,r.y,r.w,r.h);
    ctx.strokeStyle="#555";ctx.lineWidth=2;ctx.strokeRect(r.x,r.y,r.w,r.h);
  }

  for(const w of weapons){
    if(w.taken) continue;
    ctx.save();ctx.translate(w.x,w.y);ctx.rotate(w.rot||0);
    ctx.fillStyle=w.type==="shotgun"?"#d9d9d9":"#aaa";
    ctx.fillRect(-12,-4,24,8);ctx.fillRect(4,-2,9,4);ctx.restore();
  }

  for(const id in players){
    const p=players[id];
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle||0);
    ctx.fillStyle=id===myId?"#fff":"#f33";
    ctx.fillRect(-13,-13,26,26);
    ctx.fillStyle="#111";ctx.fillRect(0,-5,24,10);
    ctx.restore();
  }
  ctx.restore();

  if(matchStarted){
    ctx.strokeStyle="#fff";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(innerWidth/2,innerHeight/2,5,0,Math.PI*2);ctx.stroke();
  }
}
draw();

function drawMap(){
  if(!map)return;
  const sx=mapCanvas.width/map.width, sy=mapCanvas.height/map.height;
  mctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  mctx.fillStyle="#222";mctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);
  for(const r of map.walls){mctx.fillStyle="#050505";mctx.fillRect(r.x*sx,r.y*sy,r.w*sx,r.h*sy)}
  for(const w of weapons){if(!w.taken){mctx.fillStyle="#aaa";mctx.fillRect(w.x*sx-3,w.y*sy-3,6,6)}}
  for(const id in players){const p=players[id];mctx.fillStyle=id===myId?"#fff":"#f33";mctx.beginPath();mctx.arc(p.x*sx,p.y*sy,6,0,Math.PI*2);mctx.fill()}
}
setInterval(()=>{if(mapOpen)drawMap()},100);
