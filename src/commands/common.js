import { requireThat } from '../domain.js';
export function orderFor(interaction, ctx) {
  requireThat(interaction.guildId===ctx.config.guildId,'Comando restrito ao servidor configurado.');
  const order=ctx.store.byChannel(interaction.channelId);
  requireThat(order && order.guild_id===interaction.guildId,'Nenhum pedido neste canal.');
  return order;
}
export function isStaff(interaction, ctx) {
  return interaction.memberPermissions?.has(8n) || interaction.member?.roles?.cache?.has(ctx.config.staffRoleId);
}
export function staffFor(interaction,ctx,order) {
  requireThat(isStaff(interaction,ctx),'Somente a staff pode executar esta ação.');
  requireThat(![order.buyer_id,order.seller_id].includes(interaction.user.id),'Um participante não pode arbitrar ou executar seu próprio repasse.');
}
export function definition(name,description,options=[]) { return {name,description,options,dm_permission:false}; }
export const stringOption=(name,description,required=true,extra={})=>({type:3,name,description,required,...extra});
