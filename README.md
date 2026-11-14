# Prisma Game (prisma_game)

Puzzle de luz para celular: toque nos espelhos para girá-los e nos filtros para trocar a cor que passa,
até cada alvo receber a cor certa.

Peças: emissor, espelho (2 estados), filtro (vermelho/verde/azul, 3 estados), prisma, parede, alvo.
40 fases: 1–10 apresentam espelho, cor e prisma; 11–13 o filtro; depois três faixas geradas
(espelhos → filtro + prisma → tudo), cada uma ordenada pela nota de `difficultyScore`.
Os marcadores no topo (1–5) mostram a dificuldade; a partir de 3, os feixes brancos ganham difração em arco-íris.
TypeScript + Vite + Canvas 2D, sem engine. Som sintetizado (Web Audio). PWA instalável e offline.

## Rodar

```bash
npm install
npm run dev            # abre em http://localhost:5173 e expõe na rede (celular: http://192.168.x.x:5173)
npm test               # Vitest em watch
npm run build          # tsc + bundle em dist/
npm run check-levels   # solver em todas as fases; falha se alguma não tiver solução
npm run gen-levels     # regenera src/levels/levels.json (13 à mão + 27 geradas)
npm run icons          # regenera public/icon-*.png
```

Se o celular não abrir o endereço, libere a porta 5173 no firewall do Windows.
`check-levels` e `gen-levels` rodam TypeScript direto no Node (>= 23.6).

Atalhos de URL: `?level=12` abre direto numa fase; `?debug=1` mostra coordenadas e FPS.

## Estrutura

```
src/core/       regras puras, sem DOM (types, trace, solver, generate) + testes
src/render/     layout, draw (grade, peças, feixes), fx (partículas, pulsos, flash)
src/audio/      synth: click, note(i), chord
src/levels/     handmade.json (fases 1–10) e levels.json (todas)
src/config.ts   todos os números de sensação — ajuste aqui à mão
src/game.ts     estado, animação, transições
```

`src/core/types.ts` é o contrato central: não deixe modelo pequeno alterá-lo.
Ideias fora do MVP ficam em `IDEAS.md`.
