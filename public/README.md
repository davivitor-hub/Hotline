# NEON DUEL

Arena 1v1 top-down inspirada em Hotline Miami. Cada jogador tem 5000 de vida (100%) e cada arma tira uma porcentagem. Primeiro a 5 rodadas vence.

## Como rodar

```bash
npm install
npm start          # abre em http://localhost:3000
```

O servidor entrega o jogo **e** o WebSocket na mesma porta. Abra duas abas (ou dois computadores) e clique em **Duelo online 1v1**. Sem servidor, use **Treino contra bot**, que roda tudo no navegador.

### Deploy no Render
Suba esta pasta inteira (com `public/`) no repositório do serviço atual. Build: `npm install`. Start: `npm start`.
O cliente conecta sozinho no mesmo endereço. Se hospedar o `public/` em outro lugar, edite `SERVER_URL` no topo de `public/game.js`.

## Controles
| Tecla | Ação |
|---|---|
| WASD / setas | Mover |
| Mouse | Mirar (clique esquerdo ataca) |
| E | Pegar arma do chão (troca a atual) |
| Botão direito / F | Arremessar a arma (derruba o inimigo) |
| Espaço (segurar) | Olhar mais longe |
| Esc | Pausar |
| M | Música liga/desliga |

## Mecânicas
- **Vida**: 5000 pontos = 100%. Cada arma tira uma % (faca 40, taco 50, katana 70, pistola 35, SMG 12, fuzil 25, shotgun 15 por chumbinho x7, soco 5). Arremesso e porta tiram 10%. Ataque corpo a corpo em quem está caído causa o triplo. Tudo se ajusta no bloco `VIDA E DANO` do `shared.js`.
- **Soco derruba**: o inimigo cai por 1,7 s e solta a arma. Golpe corpo a corpo em quem está no chão causa dano triplo.
- **Arremesso**: arma arremessada derruba quem ela acertar. Arma vazia serve para isso.
- **Portas**: empurre para abrir. Quem estiver do outro lado leva a porta na cara e cai.
- **Visão**: você só vê o inimigo com linha de visão livre. Paredes e portas fechadas bloqueiam.
- **Armas**: faca, taco, katana, pistola, SMG, fuzil e shotgun. Sem recarga: acabou a munição, arremesse.
- **Rodadas**: todos começam desarmados e os mapas são simétricos (rotação de 180°), então ninguém leva vantagem.
- **Mapas**: Casa (quartos, banheiro, cozinha e sala com móveis) e Casa com Quintal (jardim, piscina, árvores e churrasqueira), alternando a cada rodada. Móveis são cobertura sólida: bloqueiam movimento, tiros e visão.
- Sangue permanente, cadáveres que deslizam, cápsulas, tremor de tela, hit-stop e trilha synthwave gerada no navegador.

## Arquitetura
- `public/shared.js`: simulação completa (mapas, física, armas, rodadas, bot). Roda no servidor e no navegador.
- `server.js`: servidor autoritativo a 60 Hz, snapshots a 30 Hz.
- `public/game.js`: cliente com predição e reconciliação do seu movimento, interpolação do inimigo, visão e efeitos.
