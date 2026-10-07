const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvasContainer');

const LARGURA = 800;
const ALTURA = 600;

const SERVER_URL = (window.PONG_SERVER_URL || location.origin).replace(/\/$/, '');
const socket = typeof io === 'function' ? io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true
}) : null;

// Audio FX Sintetizado
class SoundFX {
    constructor() { this.ctx = null; this.enabled = true; }
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    playTone(freq, type, duration, vol = 0.1) {
        if (!this.ctx || !this.enabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {}
    }
    hitPaddle() { this.playTone(440, 'square', 0.08, 0.15); }
    hitWall() { this.playTone(220, 'sine', 0.06, 0.1); }
    score() { 
        this.playTone(587.33, 'triangle', 0.12, 0.2);
        setTimeout(() => this.playTone(880, 'triangle', 0.18, 0.2), 90);
    }
    menuSelect() { this.playTone(600, 'sine', 0.04, 0.08); }
    frenzy() { this.playTone(900 + Math.random() * 300, 'sawtooth', 0.05, 0.12); }
}

const sounds = new SoundFX();

const EstadoJogo = {
    MENU_PRINCIPAL: 0,
    MENU_SKINS: 1,
    MENU_OPCOES: 2,
    JOGANDO: 3,
    ONLINE_LOBBY: 4,
    ONLINE_WAITING: 5,
    ONLINE_GAME: 6
};

let estadoAtual = EstadoJogo.MENU_PRINCIPAL;
let modoBot = false;
let modoInfinito = false;
let jogadorNum = 1;
let codigoSalaAtual = null;

// Configurações
const configs = {
    mouseP1: true,
    mouseP2: false,
    p1Up: 'KeyW',
    p1Down: 'KeyS',
    p2Up: 'ArrowUp',
    p2Down: 'ArrowDown',
    audio: true
};

const teclasPressionadas = {};

// Skins
const SKINS_RAQUETE = [
    { name: 'Cyber Cyan', color: '#00f0ff', glow: '#00f0ff' },
    { name: 'Neon Pink', color: '#ff007f', glow: '#ff007f' },
    { name: 'Gold Champion', color: '#ffd700', glow: '#ffaa00' },
    { name: 'Matrix Code', color: '#00ff66', glow: '#00ff66' },
    { name: 'Void Shadow', color: '#9333ea', glow: '#a855f7' }
];

const SKINS_BOLA = [
    { name: 'Energy Core', color: '#ffffff', glow: '#00f0ff' },
    { name: 'Magma Flare', color: '#ff3300', glow: '#ff6600' },
    { name: 'Plasma Orb', color: '#e0aaff', glow: '#c77dff' },
    { name: 'Dark Matter', color: '#00ffff', glow: '#ff007f' },
    { name: 'Gold Star', color: '#ffee00', glow: '#ffaa00' }
];

let skinP1Idx = 0;
let skinP2Idx = 1;
let skinBolaIdx = 0;

// Variáveis de Jogo
let j1Y = 250, j2Y = 250;
let bolaX = 400, bolaY = 300;
let velocidadeBase = 7;
let bolaXDir = 7, bolaYDir = 3;
let pontosJ1 = 0, pontosJ2 = 0;
let comboFrenesi = 0;
let comboMaximo = 0;
let alturaRaquete = 100, larguraRaquete = 14;
let tamanhoBola = 18;
let particulas = [];

// Menu / Mouse
let opcaoMenuPrincipal = 0;
let botoesMenu = [];
let remapeandoChave = null;

const $ = id => document.getElementById(id);

function toast(msg) {
    const e = $('toast');
    e.textContent = msg;
    e.classList.add('show');
    setTimeout(() => e.classList.remove('show'), 2200);
}

function registrarBotao(x, y, w, h, acao) {
    botoesMenu.push({ x, y, w, h, acao });
}

function gameLoop() {
    atualizar();
    desenhar();
    requestAnimationFrame(gameLoop);
}

function resetarBola(direcao = 1) {
    bolaX = LARGURA / 2;
    bolaY = ALTURA / 2;
    let vel = modoInfinito ? 8 : 7;
    bolaXDir = vel * direcao;
    bolaYDir = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 2);
    if (modoInfinito) {
        comboFrenesi = 0;
    }
}

function resetarJogo() {
    j1Y = 250;
    j2Y = 250;
    pontosJ1 = 0;
    pontosJ2 = 0;
    comboFrenesi = 0;
    comboMaximo = 0;
    particulas = [];
    resetarBola();
}

function criarParticulas(x, y, cor) {
    for (let i = 0; i < 8; i++) {
        particulas.push({
            x, y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            cor: cor,
            vida: 1.0
        });
    }
}

function atualizar() {
    if (estadoAtual === EstadoJogo.JOGANDO) {
        // Movimentação Teclado P1
        if (!configs.mouseP1) {
            if (teclasPressionadas[configs.p1Up]) j1Y = Math.max(0, j1Y - 8);
            if (teclasPressionadas[configs.p1Down]) j1Y = Math.min(ALTURA - alturaRaquete, j1Y + 8);
        }

        // Movimentação Teclado P2 ou BOT
        if (modoBot) {
            let centroBot = j2Y + alturaRaquete / 2;
            if (centroBot < bolaY - 15) j2Y += 5.5;
            else if (centroBot > bolaY + 15) j2Y -= 5.5;
            j2Y = Math.max(0, Math.min(ALTURA - alturaRaquete, j2Y));
        } else if (!configs.mouseP2) {
            if (teclasPressionadas[configs.p2Up]) j2Y = Math.max(0, j2Y - 8);
            if (teclasPressionadas[configs.p2Down]) j2Y = Math.min(ALTURA - alturaRaquete, j2Y + 8);
        }

        // Física da Bola
        bolaX += bolaXDir;
        bolaY += bolaYDir;

        if (bolaY <= tamanhoBola / 2 || bolaY >= ALTURA - tamanhoBola / 2) {
            bolaYDir *= -1;
            sounds.hitWall();
        }

        // Colisão Raquete P1
        if (bolaX - tamanhoBola / 2 <= 30 + larguraRaquete &&
            bolaX + tamanhoBola / 2 >= 30 &&
            bolaY >= j1Y && bolaY <= j1Y + alturaRaquete) {
            
            bolaXDir = Math.abs(bolaXDir);
            if (modoInfinito) {
                bolaXDir *= 1.08;
                bolaYDir *= 1.05;
                comboFrenesi++;
                if (comboFrenesi > comboMaximo) comboMaximo = comboFrenesi;
                sounds.frenzy();
                criarParticulas(bolaX, bolaY, SKINS_RAQUETE[skinP1Idx].color);
            } else {
                sounds.hitPaddle();
            }
        }

        // Colisão Raquete P2
        if (bolaX + tamanhoBola / 2 >= LARGURA - 30 - larguraRaquete &&
            bolaX - tamanhoBola / 2 <= LARGURA - 30 &&
            bolaY >= j2Y && bolaY <= j2Y + alturaRaquete) {

            bolaXDir = -Math.abs(bolaXDir);
            if (modoInfinito) {
                bolaXDir *= 1.08;
                bolaYDir *= 1.05;
                comboFrenesi++;
                if (comboFrenesi > comboMaximo) comboMaximo = comboFrenesi;
                sounds.frenzy();
                criarParticulas(bolaX, bolaY, SKINS_RAQUETE[skinP2Idx].color);
            } else {
                sounds.hitPaddle();
            }
        }

        // Pontuação
        if (bolaX < 0) {
            pontosJ2++;
            sounds.score();
            resetarBola(1);
        } else if (bolaX > LARGURA) {
            pontosJ1++;
            sounds.score();
            resetarBola(-1);
        }
    } else if (estadoAtual === EstadoJogo.ONLINE_GAME) {
        // Movimentação local teclado para o player online
        let minhaKeyUp = jogadorNum === 1 ? configs.p1Up : configs.p2Up;
        let minhaKeyDown = jogadorNum === 1 ? configs.p1Down : configs.p2Down;
        let usaMouse = jogadorNum === 1 ? configs.mouseP1 : configs.mouseP2;

        if (!usaMouse) {
            let posAtual = jogadorNum === 1 ? j1Y : j2Y;
            if (teclasPressionadas[minhaKeyUp]) posAtual = Math.max(0, posAtual - 8);
            if (teclasPressionadas[minhaKeyDown]) posAtual = Math.min(ALTURA - alturaRaquete, posAtual + 8);
            
            if (jogadorNum === 1) j1Y = posAtual; else j2Y = posAtual;
            if (socket) socket.emit('paddle:set', posAtual);
        }
    }

    // Partículas Modo Frenesi
    for (let i = particulas.length - 1; i >= 0; i--) {
        let p = particulas[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vida -= 0.04;
        if (p.vida <= 0) particulas.splice(i, 1);
    }
}

function desenhar() {
    ctx.fillStyle = "#080814";
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    if (estadoAtual === EstadoJogo.MENU_PRINCIPAL) desenharMenuPrincipal();
    else if (estadoAtual === EstadoJogo.MENU_SKINS) desenharMenuSkins();
    else if (estadoAtual === EstadoJogo.MENU_OPCOES) desenharMenuOpcoes();
    else if (estadoAtual === EstadoJogo.JOGANDO || estadoAtual === EstadoJogo.ONLINE_GAME) desenharJogo();
}

function desenharMenuPrincipal() {
    botoesMenu = [];
    ctx.font = "bold 36px Orbitron";
    ctx.fillStyle = "#00F0FF";
    ctx.textAlign = "center";
    ctx.shadowColor = "#00F0FF";
    ctx.shadowBlur = 12;
    ctx.fillText("PONG DAS 7 SOMBRAS", LARGURA / 2, 90);
    ctx.shadowBlur = 0;

    const ops = [
        "1 JOGADOR (VS BOT)",
        "2 JOGADORES (LOCAL)",
        "INFINITO FRENESI",
        "X1 ONLINE (MULTIPLAYER)",
        "SKINS E VISUAIS",
        "OPÇÕES & CONTROLES"
    ];

    for (let i = 0; i < ops.length; i++) {
        let y = 170 + (i * 55);
        let texto = (opcaoMenuPrincipal === i ? "> " : "  ") + ops[i];
        ctx.font = "20px Orbitron";
        let tw = ctx.measureText(texto).width;
        let bx = LARGURA / 2 - tw / 2 - 10;
        let by = y - 24;
        let bw = tw + 20;
        let bh = 34;

        registrarBotao(bx, by, bw, bh, () => executarMenuPrincipal(i));

        if (opcaoMenuPrincipal === i) {
            ctx.fillStyle = "rgba(255, 0, 127, 0.2)";
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = "#FF007F";
        } else {
            ctx.fillStyle = "#FFFFFF";
        }
        ctx.fillText(texto, LARGURA / 2, y);
    }
}

function executarMenuPrincipal(idx) {
    sounds.menuSelect();
    opcaoMenuPrincipal = idx;
    if (idx === 0) { modoBot = true; modoInfinito = false; estadoAtual = EstadoJogo.JOGANDO; resetarJogo(); }
    if (idx === 1) { modoBot = false; modoInfinito = false; estadoAtual = EstadoJogo.JOGANDO; resetarJogo(); }
    if (idx === 2) { modoBot = false; modoInfinito = true; estadoAtual = EstadoJogo.JOGANDO; resetarJogo(); }
    if (idx === 3) { abrirLobbyOnline(); }
    if (idx === 4) { estadoAtual = EstadoJogo.MENU_SKINS; }
    if (idx === 5) { estadoAtual = EstadoJogo.MENU_OPCOES; }
}

function desenharMenuSkins() {
    botoesMenu = [];
    ctx.font = "bold 28px Orbitron";
    ctx.fillStyle = "#FF007F";
    ctx.textAlign = "center";
    ctx.fillText("MENU DE SKINS", LARGURA / 2, 70);

    let op1 = `< RAQUETE P1: ${SKINS_RAQUETE[skinP1Idx].name} >`;
    let op2 = `< RAQUETE P2: ${SKINS_RAQUETE[skinP2Idx].name} >`;
    let op3 = `< BOLA: ${SKINS_BOLA[skinBolaIdx].name} >`;

    ctx.font = "18px Orbitron";
    ctx.fillStyle = "#00F0FF"; ctx.fillText(op1, LARGURA / 2, 140);
    registrarBotao(LARGURA / 2 - 200, 120, 400, 30, () => { skinP1Idx = (skinP1Idx + 1) % SKINS_RAQUETE.length; sounds.menuSelect(); });

    ctx.fillStyle = "#FF007F"; ctx.fillText(op2, LARGURA / 2, 210);
    registrarBotao(LARGURA / 2 - 200, 190, 400, 30, () => { skinP2Idx = (skinP2Idx + 1) % SKINS_RAQUETE.length; sounds.menuSelect(); });

    ctx.fillStyle = "#FFFF00"; ctx.fillText(op3, LARGURA / 2, 280);
    registrarBotao(LARGURA / 2 - 200, 260, 400, 30, () => { skinBolaIdx = (skinBolaIdx + 1) % SKINS_BOLA.length; sounds.menuSelect(); });

    // Preview
    ctx.fillStyle = SKINS_RAQUETE[skinP1Idx].color;
    ctx.shadowColor = SKINS_RAQUETE[skinP1Idx].glow; ctx.shadowBlur = 10;
    ctx.fillRect(LARGURA / 2 - 120, 350, 14, 80);

    ctx.fillStyle = SKINS_RAQUETE[skinP2Idx].color;
    ctx.shadowColor = SKINS_RAQUETE[skinP2Idx].glow;
    ctx.fillRect(LARGURA / 2 + 106, 350, 14, 80);

    ctx.fillStyle = SKINS_BOLA[skinBolaIdx].color;
    ctx.shadowColor = SKINS_BOLA[skinBolaIdx].glow;
    ctx.beginPath();
    ctx.arc(LARGURA / 2, 390, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Botão Voltar
    ctx.font = "20px Orbitron";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("VOLTAR AO MENU", LARGURA / 2, 510);
    registrarBotao(LARGURA / 2 - 100, 490, 200, 30, () => { estadoAtual = EstadoJogo.MENU_PRINCIPAL; sounds.menuSelect(); });
}

function desenharMenuOpcoes() {
    botoesMenu = [];
    ctx.font = "bold 28px Orbitron";
    ctx.fillStyle = "#00F0FF";
    ctx.textAlign = "center";
    ctx.fillText("OPÇÕES & CONTROLES", LARGURA / 2, 70);

    ctx.font = "16px Orbitron";
    
    // Toggle Mouse P1
    let textM1 = `MOUSE P1: ${configs.mouseP1 ? "LIGADO" : "DESLIGADO"}`;
    ctx.fillStyle = configs.mouseP1 ? "#00FF66" : "#FF0055";
    ctx.fillText(textM1, LARGURA / 2, 140);
    registrarBotao(LARGURA / 2 - 150, 125, 300, 25, () => { configs.mouseP1 = !configs.mouseP1; sounds.menuSelect(); });

    // Toggle Mouse P2
    let textM2 = `MOUSE P2: ${configs.mouseP2 ? "LIGADO" : "DESLIGADO"}`;
    ctx.fillStyle = configs.mouseP2 ? "#00FF66" : "#FF0055";
    ctx.fillText(textM2, LARGURA / 2, 190);
    registrarBotao(LARGURA / 2 - 150, 175, 300, 25, () => { configs.mouseP2 = !configs.mouseP2; sounds.menuSelect(); });

    // Remapeamentos P1
    ctx.fillStyle = "#FFFFFF";
    let txtP1Up = `P1 SUBIR: [ ${remapeandoChave === 'p1Up' ? 'PRESSIONE...' : configs.p1Up} ]`;
    let txtP1Down = `P1 DESCER: [ ${remapeandoChave === 'p1Down' ? 'PRESSIONE...' : configs.p1Down} ]`;
    ctx.fillText(txtP1Up, LARGURA / 2, 250);
    registrarBotao(LARGURA / 2 - 180, 235, 360, 25, () => { remapeandoChave = 'p1Up'; });
    ctx.fillText(txtP1Down, LARGURA / 2, 290);
    registrarBotao(LARGURA / 2 - 180, 275, 360, 25, () => { remapeandoChave = 'p1Down'; });

    // Remapeamentos P2
    let txtP2Up = `P2 SUBIR: [ ${remapeandoChave === 'p2Up' ? 'PRESSIONE...' : configs.p2Up} ]`;
    let txtP2Down = `P2 DESCER: [ ${remapeandoChave === 'p2Down' ? 'PRESSIONE...' : configs.p2Down} ]`;
    ctx.fillText(txtP2Up, LARGURA / 2, 350);
    registrarBotao(LARGURA / 2 - 180, 335, 360, 25, () => { remapeandoChave = 'p2Up'; });
    ctx.fillText(txtP2Down, LARGURA / 2, 390);
    registrarBotao(LARGURA / 2 - 180, 375, 360, 25, () => { remapeandoChave = 'p2Down'; });

    // Botão Voltar
    ctx.font = "20px Orbitron";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("SALVAR E VOLTAR", LARGURA / 2, 500);
    registrarBotao(LARGURA / 2 - 120, 480, 240, 30, () => { estadoAtual = EstadoJogo.MENU_PRINCIPAL; remapeandoChave = null; sounds.menuSelect(); });
}

function desenharJogo() {
    // Desenhar Raquetes
    ctx.fillStyle = SKINS_RAQUETE[skinP1Idx].color;
    ctx.shadowColor = SKINS_RAQUETE[skinP1Idx].glow;
    ctx.shadowBlur = 10;
    ctx.fillRect(30, j1Y, larguraRaquete, alturaRaquete);

    ctx.fillStyle = SKINS_RAQUETE[skinP2Idx].color;
    ctx.shadowColor = SKINS_RAQUETE[skinP2Idx].glow;
    ctx.fillRect(LARGURA - 30 - larguraRaquete, j2Y, larguraRaquete, alturaRaquete);

    // Partículas Frenesi
    for (let p of particulas) {
        ctx.fillStyle = p.cor;
        ctx.globalAlpha = p.vida;
        ctx.fillRect(p.x, p.y, 4, 4);
    }
    ctx.globalAlpha = 1.0;

    // Desenhar Bola
    ctx.fillStyle = SKINS_BOLA[skinBolaIdx].color;
    ctx.shadowColor = SKINS_BOLA[skinBolaIdx].glow;
    ctx.beginPath();
    ctx.arc(bolaX, bolaY, tamanhoBola / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Placa de Pontos / UI
    ctx.font = "32px Orbitron";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    
    if (modoInfinito) {
        let velAbs = Math.sqrt(bolaXDir * bolaXDir + bolaYDir * bolaYDir).toFixed(1);
        ctx.fillText(`VELOCIDADE: ${velAbs}x`, LARGURA / 2, 50);
        ctx.font = "18px Orbitron";
        ctx.fillStyle = "#FF007F";
        ctx.fillText(`COMBO FRENESI: ${comboFrenesi} (MÁX: ${comboMaximo})`, LARGURA / 2, 85);
    } else {
        ctx.fillText(`${pontosJ1}   |   ${pontosJ2}`, LARGURA / 2, 50);
    }
}

// Eventos de Mouse Canvas
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (LARGURA / rect.width);
    const my = (e.clientY - rect.top) * (ALTURA / rect.height);

    // Hover nos Menus
    if (estadoAtual === EstadoJogo.MENU_PRINCIPAL) {
        for (let i = 0; i < botoesMenu.length; i++) {
            let b = botoesMenu[i];
            if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
                opcaoMenuPrincipal = i;
            }
        }
    }

    // Controle em Jogo via Mouse
    if (estadoAtual === EstadoJogo.JOGANDO) {
        let pY = Math.max(0, Math.min(ALTURA - alturaRaquete, my - alturaRaquete / 2));
        if (configs.mouseP1) j1Y = pY;
        if (configs.mouseP2 && !modoBot) j2Y = pY;
    } else if (estadoAtual === EstadoJogo.ONLINE_GAME && socket) {
        let pY = Math.max(0, Math.min(ALTURA - alturaRaquete, my - alturaRaquete / 2));
        let usaMouse = jogadorNum === 1 ? configs.mouseP1 : configs.mouseP2;
        if (usaMouse) {
            if (jogadorNum === 1) j1Y = pY; else j2Y = pY;
            socket.emit('paddle:set', pY);
        }
    }
});

canvas.addEventListener('click', (e) => {
    sounds.init();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (LARGURA / rect.width);
    const my = (e.clientY - rect.top) * (ALTURA / rect.height);

    for (let b of botoesMenu) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
            b.acao();
            break;
        }
    }
});

// Eventos de Teclado
window.addEventListener('keydown', (e) => {
    sounds.init();
    teclasPressionadas[e.code] = true;

    if (remapeandoChave) {
        configs[remapeandoChave] = e.code;
        toast(`Tecla definida: ${e.code}`);
        remapeandoChave = null;
        sounds.menuSelect();
        return;
    }

    if (estadoAtual === EstadoJogo.MENU_PRINCIPAL) {
        if (e.code === "ArrowUp" || e.code === "KeyW") opcaoMenuPrincipal = (opcaoMenuPrincipal - 1 + 6) % 6;
        if (e.code === "ArrowDown" || e.code === "KeyS") opcaoMenuPrincipal = (opcaoMenuPrincipal + 1) % 6;
        if (e.code === "Enter" || e.code === "Space") executarMenuPrincipal(opcaoMenuPrincipal);
    } else if (e.code === "Escape") {
        estadoAtual = EstadoJogo.MENU_PRINCIPAL;
    }
});

window.addEventListener('keyup', (e) => {
    teclasPressionadas[e.code] = false;
});

// Suporte X1 Online
function abrirLobbyOnline() {
    estadoAtual = EstadoJogo.ONLINE_LOBBY;
    $('onlineScreen').classList.add('active');
    if (socket) socket.emit('rooms:list');
}

document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tabbody').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab).classList.add('active');
});

$('createBtn').onclick = () => {
    if (!socket) return toast('Servidor offline');
    socket.emit('room:create', { code: $('roomCode').value, name: $('roomName').value, public:$('roomPublic').checked });
};

$('joinBtn').onclick = () => {
    if (!socket) return toast('Servidor offline');
    socket.emit('room:join', $('joinCode').value);
};

$('refresh').onclick = () => socket?.emit('rooms:list');

$('backBtn').onclick = () => {$('onlineScreen').classList.remove('active');
    estadoAtual = EstadoJogo.MENU_PRINCIPAL;
};

$('copyBtn').onclick = () => {
    const link = `${location.origin}/?sala=${codigoSalaAtual}`;
    navigator.clipboard.writeText(link);
    toast('Link copiado!');
};

$('leaveBtn').onclick = () => {
    socket?.emit('room:leave');
    $('waitingScreen').classList.remove('active');
    estadoAtual = EstadoJogo.MENU_PRINCIPAL;
};

if (socket) {
    socket.on('rooms:update', list => {
        $('roomsList').innerHTML = list.length ? list.map(r => `
            <div class="room-item">
                <span>${r.name} (${r.players}/2)</span>
                <button onclick="socket.emit('room:join', '${r.code}')">Entrar</button>
            </div>
        `).join('') : '<span class="muted">Nenhuma sala disponível.</span>';
    });

    socket.on('room:created', d => {
        codigoSalaAtual = d.code;
        $('waitingName').textContent = d.name;
        $('waitingCode').textContent = d.code;
        $('onlineScreen').classList.remove('active');$('waitingScreen').classList.add('active');
        estadoAtual = EstadoJogo.ONLINE_WAITING;
    });

    socket.on('room:joined', d => {
        codigoSalaAtual = d.code;
        jogadorNum = d.player;
    });

    socket.on('match:start', () => {
        $('onlineScreen').classList.remove('active');$('waitingScreen').classList.remove('active');
        estadoAtual = EstadoJogo.ONLINE_GAME;
        toast(`X1 Iniciado! Você é o Jogador ${jogadorNum}`);
    });

    socket.on('opponentMoved', d => {
        if (d.player === 1) j1Y = d.y;
        else j2Y = d.y;
    });

    socket.on('room:error', msg => toast(msg));
}

// Iniciar Loop
gameLoop();