# 2 SHADOWS — Online

Jogo de tiro 1v1 para GitHub Pages + Render.

## GitHub Pages
Coloque `index.html`, `style.css`, `java.js` e `.nojekyll` na raiz do repositório e ative:
Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Render
Use o mesmo repositório ou uma cópia contendo `server.js` e `package.json`.

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

O cliente já usa:
`wss://hotline-m6gx.onrender.com`

## Controles
- WASD: andar
- Mouse: mirar
- Clique esquerdo: atirar
- E: pegar arma
- Q: abrir/fechar mapa
- Esc: pausa

## Multiplayer
Dois jogadores entram pelo mesmo endereço do GitHub Pages. O servidor cria uma sala de até 2 jogadores, gera um mapa procedural com seed e distribui armas aleatoriamente.

A movimentação tem previsão local no navegador para reduzir a sensação de atraso, enquanto o servidor continua validando colisões, tiros, dano e pickups.
