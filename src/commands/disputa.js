import { SlashCommandBuilder } from "discord.js";
import { getOrderByChannel, setStatus } from "../db.js";

export const data = new SlashCommandBuilder()
  .setName("abrir-disputa")
  .setDescription("Abre uma disputa sobre este pedido (chama a staff para arbitrar)")
  .addStringOption((opt) =>
    opt.setName("motivo").setDescription("O que aconteceu de errado").setRequired(true)
  );

export async function execute(interaction) {
  const order = getOrderByChannel(interaction.channelId);
  const motivo = interaction.options.getString("motivo");

  if (!order) {
    return interaction.reply({ content: "Nenhum pedido encontrado neste canal.", ephemeral: true });
  }
  if (![order.buyer_id, order.seller_id].includes(interaction.user.id)) {
    return interaction.reply({ content: "Só o comprador ou o vendedor deste pedido podem abrir disputa.", ephemeral: true });
  }
  if (order.status === "liberado" || order.status === "cancelado") {
    return interaction.reply({ content: `Este pedido já está \`${order.status}\` e não pode mais ser disputado.`, ephemeral: true });
  }

  setStatus(order.id, "disputa");

  const staffRoleId = process.env.STAFF_ROLE_ID;
  await interaction.reply(
    `🚩 **Disputa aberta por <@${interaction.user.id}>** no pedido ${order.id}.\n` +
    `**Motivo:** ${motivo}\n\n` +
    `A liberação automática do pagamento fica travada até a staff decidir.\n` +
    (staffRoleId ? `<@&${staffRoleId}>` : "@staff")
  );
}
