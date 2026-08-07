import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import { customAlphabet } from "nanoid";
import { createOrder, setPreference } from "../db.js";
import { criarLinkPagamento } from "../mercadopago.js";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

export const data = new SlashCommandBuilder()
  .setName("vender")
  .setDescription("Cria uma negociação segura entre você e um comprador")
  .addUserOption((opt) =>
    opt.setName("comprador").setDescription("Quem está comprando").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("descricao").setDescription("O que está sendo vendido").setRequired(true)
  )
  .addNumberOption((opt) =>
    opt.setName("preco").setDescription("Preço em reais (ex: 150.90)").setRequired(true)
  );

export async function execute(interaction) {
  const buyer = interaction.options.getUser("comprador");
  const description = interaction.options.getString("descricao");
  const price = interaction.options.getNumber("preco");
  const seller = interaction.user;

  if (buyer.id === seller.id) {
    return interaction.reply({ content: "Você não pode vender pra si mesmo.", ephemeral: true });
  }
  if (price <= 0) {
    return interaction.reply({ content: "O preço precisa ser maior que zero.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // Cria um canal privado só pra essa negociação (comprador + vendedor + staff)
  const orderId = `ord_${nanoid()}`;
  const staffRoleId = process.env.STAFF_ROLE_ID;

  const channel = await interaction.guild.channels.create({
    name: `pedido-${orderId.slice(4)}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: buyer.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: seller.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ...(staffRoleId
        ? [{ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }]
        : []),
    ],
  });

  const amountCents = Math.round(price * 100);

  createOrder({
    id: orderId,
    guild_id: interaction.guild.id,
    channel_id: channel.id,
    buyer_id: buyer.id,
    seller_id: seller.id,
    description,
    amount_cents: amountCents,
    created_at: new Date().toISOString(),
  });

  const { preferenceId, checkoutUrl } = await criarLinkPagamento({
    orderId,
    description,
    amountCents,
  });
  setPreference(orderId, preferenceId);

  await channel.send(
    `📦 **Novo pedido — ${orderId}**\n` +
    `**Item:** ${description}\n` +
    `**Valor:** R$ ${price.toFixed(2)}\n` +
    `**Comprador:** <@${buyer.id}>\n` +
    `**Vendedor:** <@${seller.id}>\n\n` +
    `${buyer}, pague com segurança pelo link abaixo. O valor fica retido até você confirmar o recebimento:\n${checkoutUrl}\n\n` +
    `Depois de receber o produto, rode \`/confirmar-recebimento\` neste canal.\n` +
    `Se algo der errado, use \`/abrir-disputa\`.`
  );

  return interaction.editReply({ content: `Pedido criado em ${channel}.` });
}
