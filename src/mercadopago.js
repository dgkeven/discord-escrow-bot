import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const preferenceApi = new Preference(client);
const paymentApi = new Payment(client);

/**
 * Cria um link de pagamento (Checkout Pro) para um pedido.
 * O comprador paga via Pix, boleto ou cartão; o valor cai na SUA conta
 * Mercado Pago (a do bot/servidor) — é você quem controla quando repassar
 * ao vendedor, depois que o comprador confirmar o recebimento.
 */
export async function criarLinkPagamento({ orderId, description, amountCents }) {
  const amount = amountCents / 100;

  const preference = await preferenceApi.create({
    body: {
      items: [
        {
          id: orderId,
          title: description.slice(0, 250),
          quantity: 1,
          unit_price: amount,
          currency_id: "BRL",
        },
      ],
      external_reference: orderId,
      notification_url: process.env.MP_WEBHOOK_URL,
      back_urls: {
        success: process.env.MP_SUCCESS_URL,
        pending: process.env.MP_SUCCESS_URL,
        failure: process.env.MP_SUCCESS_URL,
      },
      auto_return: "approved",
      statement_descriptor: "ESCROW DISCORD",
    },
  });

  return {
    preferenceId: preference.id,
    checkoutUrl: preference.init_point,
  };
}

/** Busca os detalhes de um pagamento pelo id (usado ao receber o webhook). */
export async function buscarPagamento(paymentId) {
  return paymentApi.get({ id: paymentId });
}

export default { criarLinkPagamento, buscarPagamento };
