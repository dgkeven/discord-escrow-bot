import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { getOrderByChannel, markReleased, setStatus } from "../db.js";

export const data = new SlashCommandBuilder()
  .setName("liberar-manual")
  .setDescription("[Staff] Decide uma disputa: libera para o vendedor ou cancela o pedido")
  .addStringOption((opt) =>
    opt
      .setName("decisao")
      .setDescription("O que fazer com o pagamento retido")
      .setRequired(true)
      .addChoices(
        { name: "Liberar para o vendedor", value: "liberar" },
        { name: "Cancelar e devolver ao comprador", value: "cancelar" }
      )
  );

export async function execute(interaction) {
  const staffRoleId = process.env.STAFF_ROLE_ID;
  const isStaff =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (staffRoleId && interaction.member.roles.cache.has(staffRoleId));

  if (!isStaff) {
    return interaction.reply({ content: "Só a staff pode usar este comando.", ephemeral: true });
  }

  const order = getOrderByChannel(interaction.channelId);
  if (!order) {
    return interaction.reply({ content: "Nenhum pedido encontrado neste canal.", ephemeral: true });
  }

  const decisao = interaction.options.getString("decisao");

  if (decisao === "liberar") {
    markReleased(order.id);
    return interaction.reply(
      `⚖️ Disputa resolvida por <@${interaction.user.id}>: pagamento de R$ ${(order.amount_cents / 100).toFixed(2)} liberado para <@${order.seller_id}>.\n` +
      `Lembrete: o repasse via Pix/transferência ainda precisa ser feito manualmente pela conta Mercado Pago da staff.`
    );
  }

  // Nota: o estorno em si precisa ser feito no painel do Mercado Pago
  // (ou via API de reembolso) — este comando só atualiza o status interno.
  setStatus(order.id, "cancelado");
  return interaction.reply(
    `⚖️ Disputa resolvida por <@${interaction.user.id}>: pedido cancelado. ` +
    `Estorne o pagamento para <@${order.buyer_id}> pelo painel do Mercado Pago.`
  );
}
