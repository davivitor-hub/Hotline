# NEON DUEL

Arena 1v1 top-down inspirada em Hotline Miami. Um tiro, uma morte. Primeiro a 5 rodadas vence.

## Como rodar

```bash
npm install
npm start          # abre em http://localhost:3000
```

O servidor entrega o jogo **e** o WebSocket na mesma porta. Abra duas abas (ou dois computadores) e clique em **Duelo online 1v1**. Sem servidor, use **Treino contra bot**, que roda tudo no navegador.

### Deploy no Render
Suba esta pasta inteira (com `public/`) no repositório. Build: `npm install`. Start: `npm start`. Health check path: `/health`. No plano gratuito o Render dorme após inatividade; a primeira conexão pode levar ~30 s.
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
- **Um golpe mata**: tiro, faca, taco e katana matam na hora.
- **Soco derruba**: o inimigo cai por 1,7 s e solta a arma. Qualquer ataque em quem está no chão é uma execução.
- **Arremesso**: arma arremessada derruba quem ela acertar. Arma vazia serve para isso.
- **Portas**: empurre para abrir. Quem estiver do outro lado leva a porta na cara e cai.
- **Visão**: você só vê o inimigo com linha de visão livre. Paredes e portas fechadas bloqueiam.
- **Armas**: faca, taco, katana, pistola, SMG, fuzil e shotgun. Sem recarga: acabou a munição, arremesse.
- **Rodadas**: todos começam desarmados e os mapas são simétricos (rotação de 180°), então ninguém leva vantagem.
- **Mapas**: Escritório e Casa Noturna, alternando a cada rodada.
- Sangue permanente, cadáveres que deslizam, cápsulas, tremor de tela, hit-stop e trilha synthwave gerada no navegador.

## Arquitetura
- `public/shared.js`: simulação completa (mapas, física, armas, rodadas, bot). Roda no servidor e no navegador.
- `server.js`: servidor autoritativo a 60 Hz, snapshots a 30 Hz.
- `public/game.js`: cliente com predição e reconciliação do seu movimento, interpolação do inimigo, visão e efeitos.
