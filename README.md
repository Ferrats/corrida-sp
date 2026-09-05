# Corrida SP

Protótipo de corrida arcade 2D visto de cima, com contrarrelógio de três voltas no navegador.

## Como jogar

Clique em **Jogar**, aguarde a contagem regressiva e siga os portais amarelos. Complete dez portais em ordem e cruze a chegada no sentido correto para registrar uma volta. Depois de três voltas válidas, veja o tempo total e os tempos individuais; o melhor total fica salvo neste navegador quando o armazenamento estiver disponível.

## Circuito SP 01

Traçado fechado com reta principal longa, curvão rápido, sequência em S, retorno fechado e miolo técnico antes da curva sul. A largura varia suavemente de 260 pixels na reta a 180 pixels no miolo. Use os avisos PREPARE/FREIE para antecipar a frenagem antes do S e do retorno. O minimapa mostra o carro em branco e o próximo portal em amarelo.

As zebras ficam dentro da superfície válida; as áreas de escape ficam fora e invalidam a volta, assim como a grama. Desenho, superfície e portais são derivados da mesma geometria em `src/game/track.ts`. Os recordes deste circuito têm uma chave própria e não substituem nem carregam os tempos do oval anterior.

Sair do asfalto reduz a velocidade e invalida a volta atual. Complete o percurso para recomeçar uma volta válida. Tentativas inválidas continuam contando no tempo total. A superfície é determinada pelo centro do carro; esta versão não simula pneus individuais ou muros na pista.

## Controles

- `W`: acelerar
- `S`: frear e engatar a ré
- `A` / `D`: esterçar
- `Espaço`: reduzir a aderência e fazer drift
- As setas também aceleram, freiam e esterçam.
- `Esc`: pausar/continuar. Ao trocar de aba ou janela, o jogo pausa e limpa as teclas pressionadas, preservando posição, velocidade e relógio.
- `R`: reposicionar no último portal aceito (invalida a volta, sem apagar tempo ou progresso).
- **Reiniciar corrida**: disponível na pausa e no resultado; reinicia a contagem, mas preserva o recorde.

O protótipo requer teclado. As instruções se ajustam à largura da janela; controles de toque ainda não estão disponíveis.

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
    RaceScene.ts      desenho, câmera, controles e integração com a interface
  game/
    race.ts           simulação, voltas e recordes
    track.ts          traçado, superfície e portais direcionais
```

Não há backend, React ou assets externos nesta versão. A pista e o carro são desenhados pelo próprio Phaser como placeholders.

## Testes

`npm test` testa o modelo real de produção sem simular o Phaser: geometrias, sentido/ordem dos checkpoints, três voltas completas, grama, pausa, reinício, recuperação, recordes e movimento em 30/60/144 fps. Também verifica que as bordas não se cruzam, a largura é válida e as áreas de escape ficam fora do asfalto. Um piloto de teste percorre três voltas com acelerador, freio e direção. Isso valida a simulação, não o desempenho da GPU nem a usabilidade humana.

A simulação usa passos fixos de 120 Hz e posição interpolada na renderização. Quadros longos têm recuperação física limitada a 250 ms para evitar saltos e trabalho acumulado, mas o tempo perdido continua no cronômetro. Não há adversários, multiplayer, controle por toque ou cenário urbano nesta entrega.
