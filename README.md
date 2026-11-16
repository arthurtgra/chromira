# Chromira

Puzzle de luz para celular: toque nos espelhos para girá-los e nos filtros para trocar a cor que passa,
até cada alvo receber a cor certa.

Peças: emissor, espelho (2 estados), divisor de feixe (2 estados: reflete e deixa passar ao mesmo tempo),
filtro (vermelho/verde/azul, 3 estados), prisma, parede, alvo (pode exigir cor combinada).
70 fases: 1–10 apresentam espelho, cor e prisma; 11–13 o filtro; depois cinco faixas geradas
(espelhos → filtro + prisma → tudo → 41–50 alvos de cor combinada, alimentados por lançadores
diferentes → 51–60 divisor de feixe → 61–70 divisor + espelho + filtro + prisma juntos), cada uma ordenada pela nota de `difficultyScore`.
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

## Editor de fases (modo desenvolvedor)

Com o modo Developer ligado (menu → Developer → senha), o lápis na barra de baixo abre o editor da fase atual:

- **Mover / girar** (padrão): arraste uma peça para outra célula vazia (a luz acompanha); toque para girar
  (espelho, divisor, dicroico, lançador), trocar a cor do filtro ou do alvo. Soltar fora da grade apaga.
- **Lançador, espelho, divisor, filtro, prisma, dicroico, parede, alvo**: toque numa célula vazia para adicionar.
- **Cor**: toque num lançador, alvo, dicroico ou filtro para trocar a cor. **Apagar**: toque para remover.
- A fase começa exatamente como aparece no editor (as rotações viram o `start`).
- **Save** grava em `src/levels/edits.json` (precisa do `npm run dev`; funciona pelo celular na rede também)
  e mostra quantas soluções a fase tem. Sem servidor, fica salvo no aparelho e o JSON vai para a área de transferência.
- **Revert** volta a fase para a versão gerada. **Done** sai do editor.

`edits.json` substitui a fase na mesma posição (número da fase), por cima de `levels.json`, e o
`check-levels` também usa as edições. Se o `gen-levels` mudar a ordem das fases, confira as edições.

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
