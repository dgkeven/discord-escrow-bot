# Bot de pedidos com Mercado Pago e repasse manual

Versão 2.0: canal privado no Discord, Checkout Pro, confirmação por API,
conciliação periódica, disputas e registro auditável dos repasses manuais.

**O bot não é um serviço de custódia financeira nem transfere dinheiro ao vendedor.**
O pagamento entra na conta Mercado Pago configurada. A staff confere o beneficiário,
executa a transferência externamente e registra o comprovante. O reembolso é feito
no painel Mercado Pago e só é reconhecido pelo bot após consulta à API.
As taxas são custeadas pela operação; o valor nominal do pedido é o valor do repasse.

## Estado de validação desta entrega

- 40 testes automatizados passaram com Node 24.19.0: SQLite real, servidor HTTP
  local real e respostas externas simuladas. Incluem reinício, concorrência,
  assinatura, duplicidade, valor/recebedor divergente, reembolso e chargeback.
- `npm run check` passou.
- A instalação npm foi bloqueada pela rede do ambiente de desenvolvimento.
  A dependência Discord, a auditoria npm e a integração real ainda não foram executadas.
- A versão direta de `discord.js` está fixada. O `package-lock.json` deve ser gerado
  por `npm install`, revisado e commitado antes da implantação; use `npm ci` depois.
- A configuração de exemplo mantém produção desabilitada. Testes locais não
  certificam uma operação financeira real; conclua a homologação abaixo.

## Requisitos e configuração

Use Node.js **24.15 ou posterior da série 24**, disco persistente local e uma única
instância. SQLite utiliza WAL, `synchronous=FULL` e transações. Não execute em
filesystem temporário, pasta de sincronização ou múltiplas réplicas.

```sh
npm install --ignore-scripts
npm run check
npm test
node scripts/discord-smoke.js
npm audit --omit=dev --audit-level=high
```

Copie `.env.example` para `.env` e preencha os valores no servidor, sem enviar
credenciais pelo Discord ou commitá-las. **Se o token que estava no arquivo de
exemplo antigo era real, revogue-o no Discord Developer Portal.** Remover o valor
do arquivo atual não o remove do histórico Git.

| Variável | Uso |
| --- | --- |
| `DISCORD_TOKEN` | Token novo do bot |
| `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | Aplicação e servidor autorizados |
| `STAFF_ROLE_ID` | Cargo de operadores; não pode ser @everyone |
| `STAFF_CHANNEL_ID` | Canal privado da equipe para alertas |
| `MP_ACCESS_TOKEN` | Credencial do recebedor no ambiente escolhido |
| `MP_COLLECTOR_ID` | ID da conta recebedora, conferido em `/users/me` ao iniciar |
| `MP_WEBHOOK_SECRET` | Segredo de assinatura em Suas integrações → Webhooks |
| `MP_WEBHOOK_URL` | HTTPS público terminando em `/webhooks/mercadopago` |
| `MP_SUCCESS_URL` | URL HTTPS de retorno; não confirma pagamento |
| `MP_LIVE_MODE` | `false` em homologação; `true` em produção |
| `ENABLE_REAL_PAYMENTS` | Deve ser `true` para permitir `MP_LIVE_MODE=true` |
| `DATABASE_PATH` | Caminho absoluto recomendado, em disco persistente |
| `HOST`, `PORT` | Padrão `127.0.0.1:3000`, atrás de proxy HTTPS |
| `MAX_ORDER_CENTS` | Teto por pedido, padrão 100000 centavos (R$ 1.000) |
| `MAX_OPEN_ORDERS` | Máximo de pedidos abertos por vendedor, padrão 3 |
| `PRAZO_CONFIRMACAO_DIAS` | Prazo para lembrete diário à staff; nunca libera por tempo |

Configure somente o tópico **Pagamentos (`payment`)** do Checkout Pro no painel
de Webhooks. Notificações IPN e outros tópicos não são aceitos neste endpoint.
O webhook exige assinatura HMAC-SHA256, `x-request-id`, `data.id` na query e
correspondência com o corpo. Uma assinatura antiga autêntica pode ser reenviada;
a entrega é deduplicada em disco e o processamento consulta o estado atual da API.

Convide o bot com escopos `bot` e `applications.commands` e permissões:
gerenciar canais, ver canais, enviar mensagens e ler histórico. Não é necessário
administrador. O bot recebe permissão explícita nos canais privados. Configure o
canal da staff como privado e verifique o acesso do bot. Administradores do servidor
continuam tendo acesso aos canais conforme as regras do Discord.

```sh
npm run deploy-commands
npm start
```

`npm start` inicia bot, HTTP e workers no mesmo processo. O antigo comando
`npm run server` foi removido para evitar duas instâncias concorrentes. A inicialização
confere a conta Mercado Pago, o ID do bot e suas permissões.

## Fluxo de operação

1. Vendedor usa `/vender comprador descricao preco`. Preço mínimo R$ 1,00,
   duas casas decimais; contas bot e venda para si próprio são rejeitadas.
2. Canal e pedido são registrados antes do checkout. O link expira em 24 horas;
   falha ambígua de criação não gera uma segunda preferência automaticamente.
3. Webhook assinado é persistido antes do HTTP 200. Um worker consulta a API,
   verifica referência, BRL, valor integral, recebedor e ambiente. A busca periódica
   por referência também descobre pagamentos sem webhook.
4. O comprador usa `/confirmar-recebimento`. O pedido vai para `repasse_pendente`;
   isso não afirma que a transferência aconteceu.
5. Uma pessoa da staff que não seja participante usa `/preparar-repasse`.
   O bot reconcilia novamente, exige exatamente um pagamento aprovado, sem
   tentativa pendente adicional, sem reembolso e com saldo liberado pelo Mercado Pago.
6. A reserva identifica um único operador e uma operação. O operador confere os
   dados bancários do vendedor fora do bot, efetua a transferência uma única vez
   e usa `/registrar-repasse operacao comprovante` com o identificador bancário.
   Não informe CPF, chave Pix ou dados completos no comprovante textual.
7. O registro é uma declaração auditada da staff; não é uma verificação bancária.
   Reservas não expiram nem são refeitas automaticamente, evitando repetição após
   um timeout. Se o operador ficar indisponível, suspenda a operação e reconcilie
   extrato e auditoria antes de qualquer intervenção técnica.

| Comando | Quem utiliza / efeito |
| --- | --- |
| `/pedido-status` | Participantes ou staff; consulta dados persistidos |
| `/reconciliar-pedido` | Staff; atualiza dados da API |
| `/abrir-disputa motivo` | Participantes; bloqueia antes de uma reserva de repasse |
| `/liberar-manual decisao motivo` | Staff independente; autoriza repasse ou solicita reembolso |
| `/cancelar-pedido motivo` | Staff independente; encerra negociação não paga no bot |

Disputa pode ser aberta antes do pagamento: o recebimento posterior é registrado
sem remover o bloqueio. Pagamento tardio de pedido cancelado vai para revisão.
Reembolsos parciais, múltiplos pagamentos e divergências bloqueiam o repasse;
reembolso total e chargeback atualizam o estado. A staff precisa resolver pagamentos
extras pelo painel e reconciliar antes de uma nova decisão. Cancelar negociação
no bot não cancela a preferência nem uma cobrança pendente na instituição.

Depois de uma reserva, o operador já pode estar executando a transferência. Nesse
ponto, intervenções exigem contato imediato com a staff. O bot não pode desfazer
uma transferência externa ou impedir um operador de usar o banco fora do fluxo.
Se um chargeback chegar depois da transferência, o comprovante continua registrável
e o estado de risco é preservado. O bot não promete proteção contra chargeback.

## Recuperação e observabilidade

- `GET /healthz` retorna 200 quando o bot está disponível e não há falhas persistentes
  nas filas/conciliação; caso contrário, 503. Monitore externamente disponibilidade,
  filas, logs, espaço em disco e o canal da staff.
- Filas de pagamento e de mensagens persistem em SQLite e tentam novamente com
  atraso progressivo. Notificações Discord podem se repetir após falha de confirmação;
  esse reenvio não repete transações financeiras. Avisos indicam o estado na entrega.
- A conciliação agenda cada pedido a cada cinco minutos, em lotes de cinco. O tempo
  efetivo cresce com o volume e indisponibilidade da API; a arquitetura é para baixo
  volume. Histórico financeiro permanece sob conciliação mesmo após o encerramento.
- A fila e a auditoria não são podadas automaticamente. Acompanhe o crescimento do
  disco; retenção e arquivamento exigem política da operação.
- `npm run backup` usa a API de backup online SQLite e verifica integridade. Guarde
  cópias em local protegido fora da máquina e valide restauração antes de produção.
  Não copie apenas o arquivo principal enquanto houver uma instância escrevendo WAL.
- Para restaurar, pare o bot, preserve o banco atual, restaure em novo caminho e
  configure `DATABASE_PATH`. Reconcilie todos os pedidos e extratos **antes de
  repassar novamente**: um backup antigo pode não conter transferências já realizadas.
- Credenciais e dados pessoais completos das respostas Mercado Pago não são gravados
  nos logs. Auditoria inclui IDs, estados, motivo, operador e referência do comprovante.

## Migração da versão anterior

Pare a versão antiga e faça backup antes da primeira execução. Aponte explicitamente
`DATABASE_PATH` para o banco existente (`escrow.sqlite`). Não crie um banco vazio em
produção por engano. A migração adiciona tabelas/colunas e preserva o estado anterior
na auditoria; todos os pedidos antigos ficam em `revisao`, com bloqueio de repasse.

O antigo estado `liberado` não prova transferência. Não há liberação em massa de
pedidos legados: é necessária conferência individual de extratos e comprovantes e
uma migração específica, documentada, para retomar esses pedidos. Pedidos novos
seguem o fluxo novo. Não remova `legacy_review` com SQL para contornar o bloqueio.

## Homologação antes de receber dinheiro real

Use aplicação, contas e banco de teste separados. Faça a compra com usuários de
teste do Mercado Pago e confirme:

1. O bot cria canal privado e comprador/vendedor conseguem vê-lo; outros membros não.
2. O link de teste abre e a notificação assinada real é aceita no HTTPS público.
3. Pagamento, confirmação e autorização de repasse funcionam; conta sem saldo
   liberado não consegue reservar repasse.
4. Reinicie o processo entre recebimento e processamento do webhook e confirme a
   recuperação; interrompa o acesso do bot ao canal e depois restaure as mensagens.
5. Faça reembolso de teste e confira atualização, inclusive após disputa.
6. Valide backup/restauração, monitoramento e a revisão de dependências (`npm audit`).

Somente depois, use outra configuração/banco para produção, credenciais da conta
correta e `MP_LIVE_MODE=true` junto de `ENABLE_REAL_PAYMENTS=true`. A adequação da
conta para receber por terceiros e as regras de repasse precisam estar confirmadas
com o provedor; este código não configura Marketplace/OAuth nem uma conta escrow.

## Estrutura

```text
src/
  config.js           valida configuração e bloqueia produção por padrão
  domain.js           valores e validações financeiras
  db.js               SQLite, migração, auditoria, filas, reservas e transações
  mercadopago.js       cliente HTTPS com timeout, sem repetição automática de POST
  service.js          conciliação e serialização por pedido
  webhook.js          validação de assinatura
  server.js           HTTP de webhook e saúde
  worker.js           filas, conciliação e lembretes
  index.js            início, permissões e encerramento
  deploy-commands.js  registro de comandos
  commands/           comandos Discord e autorização
scripts/
  backup.js           backup consistente
  check.js            verificação de sintaxe
  discord-smoke.js    validação com SDK instalado, sem login
test/
  financial.test.js   regressões financeiras e HTTP
```

As dependências auxiliares foram substituídas por HTTP, fetch, crypto, carregamento
de `.env` e SQLite nativos do Node 24. Só o gateway Discord depende de pacote npm.
O workflow em `.github/workflows/verify.yml` instala dependências, testa, valida
payloads com o SDK real e executa auditoria. Ele ainda não foi executado no GitHub.

Referências oficiais: [Webhooks Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/notifications/webhooks),
[busca de pagamentos](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/search-payments/get),
[vigência de preferências](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/term-of-preference),
[criação de canais Discord](https://docs.discord.com/developers/resources/guild#create-guild-channel).
