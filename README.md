# Bot de escrow para Discord (Mercado Pago)

Bot que cria uma negociação segura entre comprador e vendedor: o pagamento
fica retido na sua conta Mercado Pago e só é liberado quando o comprador
confirma o recebimento do produto (ou quando a staff resolve uma disputa).

## O que este MVP já faz

- `/vender @comprador descrição preço` — cria um canal privado + link de pagamento
- Webhook do Mercado Pago confirma o pagamento automaticamente (nunca confia só no bot)
- `/confirmar-recebimento` — só o comprador roda; marca o pagamento como liberado
- `/abrir-disputa motivo` — trava a liberação e chama a staff
- `/liberar-manual` — staff decide a disputa (liberar ou cancelar)

## O que este MVP NÃO automatiza ainda (importante!)

O dinheiro cai na **sua** conta Mercado Pago, não na do vendedor. "Liberar"
aqui atualiza o status no bot e avisa a staff — o repasse em si (Pix,
transferência) ainda é manual. Isso é proposital para a primeira versão:
simples de configurar e sem exigir que cada vendedor conecte a própria
conta Mercado Pago.

Para automatizar o repasse também, o próximo passo é configurar o
**Mercado Pago Marketplace** (split de pagamento), onde cada vendedor
conecta a própria conta via OAuth e o valor já nasce dividido entre você
(taxa) e o vendedor. Posso te ajudar a evoluir para isso depois que essa
primeira versão estiver rodando.

## Passo a passo

### 1. Criar o bot no Discord
1. Vá em https://discord.com/developers/applications e crie uma aplicação
2. Em "Bot", crie o bot e copie o **token** → `DISCORD_TOKEN`
3. Em "General Information", copie o **Application ID** → `DISCORD_CLIENT_ID`
4. Ative os intents necessários em "Bot" (Server Members não é obrigatório aqui)
5. Em "OAuth2 > URL Generator", marque `bot` e `applications.commands`, com
   permissões: Manage Channels, Send Messages, View Channels. Use a URL
   gerada para convidar o bot pro seu servidor
6. Copie o ID do seu servidor (ative o Modo Desenvolvedor no Discord e
   clique com botão direito no servidor) → `DISCORD_GUILD_ID`
7. Copie o ID do cargo de staff/moderador → `STAFF_ROLE_ID`

### 2. Configurar o Mercado Pago
1. Crie uma conta em https://www.mercadopago.com.br
2. Vá em "Seu negócio > Configurações > Credenciais de produção" (ou teste)
3. Copie o **Access Token** → `MP_ACCESS_TOKEN`
4. Para receber o webhook localmente durante o desenvolvimento, use o
   [ngrok](https://ngrok.com): `ngrok http 3000`, e use a URL gerada +
   `/webhooks/mercadopago` em `MP_WEBHOOK_URL`

### 3. Instalar e rodar
```bash
cp .env.example .env
# edite o .env com os valores acima
npm install
npm run deploy-commands   # registra os comandos /vender, /confirmar-recebimento etc
npm start                 # sobe o bot E o servidor de webhook juntos
```

### 4. Testar
1. No seu servidor, rode `/vender @alguém "Camiseta streetwear" 150.00`
2. O bot cria um canal privado com o link de pagamento
3. Pague com um usuário de teste do Mercado Pago (ou valor pequeno real)
4. O webhook confirma o pagamento e o bot avisa no canal
5. O comprador roda `/confirmar-recebimento`
6. A staff é avisada para repassar o valor ao vendedor

## Estrutura

```
src/
  index.js            # inicia o bot + o servidor de webhook
  server.js            # recebe e valida o webhook do Mercado Pago
  mercadopago.js        # cria o link de pagamento (Checkout Pro)
  db.js                 # SQLite: guarda os pedidos e seus status
  deploy-commands.js    # registra os comandos slash no Discord
  commands/
    vender.js
    confirmar.js
    disputa.js
    liberar.js
```

## Avisos importantes

- **Nunca** deixe o dinheiro de terceiros passar pela sua conta pessoal sem
  controle — use sempre uma conta Mercado Pago dedicada a isso, com extrato
  organizado por pedido.
- Deixe as regras do escrow (prazo de confirmação, critério de disputa,
  taxa cobrada) visíveis e fixadas no servidor, não só no código.
- Este é um MVP funcional, não um produto pronto para produção em grande
  escala — antes de operar com volume alto, vale revisar segurança do
  webhook (verificação de assinatura do Mercado Pago), rate limiting e
  logs de auditoria.
# discord-escrow-bot
