import { SlashCommandBuilder } from "discord.js";
import { getOrderByChannel, markReleased } from "../db.js";

export const data = new SlashCommandBuilder()
  .setName("confirmar-recebimento")
  .setDescription("Confirma que você recebeu o produto e libera o pagamento ao vendedor");

export async function execute(interaction) {
  const order = getOrderByChannel(interaction.channelId);

  if (!order) {
    return interaction.reply({ content: "Nenhum pedido encontrado neste canal.", ephemeral: true });
  }
  if (interaction.user.id !== order.buyer_id) {
    return interaction.reply({ content: "Só o comprador pode confirmar o recebimento.", ephemeral: true });
  }
  if (order.status !== "pago" && order.status !== "enviado") {
    return interaction.reply({
      content: `Este pedido está com status \`${order.status}\` e não pode ser confirmado agora.`,
      ephemeral: true,
    });
  }

  // AQUI é o ponto de liberação real do dinheiro. Nesta versão inicial, o
  // valor já está na sua conta Mercado Pago (não na do vendedor) — marcar
  // como liberado é o gatilho para você (admin) fazer o repasse via Pix.
  // Para automatizar o repasse 100%, o próximo passo é configurar o
  // Mercado Pago Marketplace com o vendedor conectando a própria conta.
  markReleased(order.id);

  await interaction.reply(
    `✅ **Recebimento confirmado por <@${order.buyer_id}>.**\n` +
    `Pagamento de R$ ${(order.amount_cents / 100).toFixed(2)} liberado para <@${order.seller_id}>.`
  );

  const staffRoleId = process.env.STAFF_ROLE_ID;
  if (staffRoleId) {
    await interaction.followUp(
      `<@&${staffRoleId}> repassar R$ ${(order.amount_cents / 100).toFixed(2)} para <@${order.seller_id}> (pedido ${order.id}).`
    );
  }
}
