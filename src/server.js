import "dotenv/config";
import express from "express";
import { buscarPagamento } from "./mercadopago.js";
import { getOrder, markPaid } from "./db.js";

/**
 * Este servidor roda separado do bot (mas pode importar o client do Discord
 * pra postar mensagens direto nos canais — veja `attachDiscordClient`).
 */
const app = express();
app.use(express.json());

let discordClient = null;
export function attachDiscordClient(client) {
  discordClient = client;
}

app.post("/webhooks/mercadopago", async (req, res) => {
  // Responde rápido — o Mercado Pago reenvia se não receber 200 a tempo.
  res.sendStatus(200);

  try {
    const topic = req.body?.type || req.query.topic;
    const paymentId = req.body?.data?.id || req.query.id;
    if (topic !== "payment" || !paymentId) return;

    const payment = await buscarPagamento(paymentId);
    if (payment.status !== "approved") return;

    const orderId = payment.external_reference;
    const order = getOrder(orderId);
    if (!order || order.status !== "aguardando_pagamento") return;

    markPaid(order.id, String(paymentId));

    if (discordClient) {
      const channel = await discordClient.channels.fetch(order.channel_id).catch(() => null);
      if (channel) {
        await channel.send(
          `💰 **Pagamento confirmado!** O valor está retido com segurança.\n` +
          `Vendedor, pode enviar o produto. Quando o comprador receber, ele deve rodar \`/confirmar-recebimento\`.`
        );
      }
    }
  } catch (err) {
    console.error("Erro ao processar webhook do Mercado Pago:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server do Mercado Pago rodando na porta ${PORT}`);
});

export default app;
