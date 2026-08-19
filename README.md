# Corrida SP

Protótipo **0.1.0** de um jogo de corrida arcade 2D visto de cima, feito para rodar diretamente no navegador.

A versão atual é um Time Trial de três voltas em um circuito técnico inspirado em Interlagos, com checkpoints, cronômetros, limites de pista e consequências para saídas e colisões.

## Controles

- `W`: acelerar
- `S`: frear e engatar a ré
- `A` / `D`: esterçar
- `Espaço`: reduzir a aderência e fazer drift
- `R`: reiniciar o Time Trial

## Rodar localmente

Requer Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

O terminal mostrará o endereço local do jogo.

## Verificar a versão de produção

```bash
npm run build
npm run preview
```

O build estático é gerado em `dist/`. Essa pasta pode ser publicada em Cloudflare Pages, GitHub Pages, Netlify, Vercel ou qualquer hospedagem de arquivos estáticos.

Configuração típica de deploy:

- comando de build: `npm run build`
- diretório de saída: `dist`

## Estrutura

```text
src/
  main.ts             configuração do Phaser
  style.css           página e canvas
  scenes/
    RaceScene.ts      pista, carro, controles, câmera e HUD
```

Não há backend, React ou assets externos nesta versão. A pista e o carro são desenhados pelo próprio Phaser como placeholders.

