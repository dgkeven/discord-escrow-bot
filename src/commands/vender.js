import { cents, requireThat } from '../domain.js';
import { definition, stringOption } from './common.js';
export const data=definition('vender','Cria pedido com pagamento na conta da operação e repasse manual',[
  {type:6,name:'comprador',description:'Comprador do produto',required:true},
  stringOption('descricao','Descrição do produto',true,{min_length:1,max_length:250}),
  {type:10,name:'preco',description:'Valor em reais, com até duas casas decimais',required:true,min_value:1,max_value:1000000},
]);
export async function execute(i,ctx) {
  const buyer=i.options.getUser('comprador'),description=i.options.getString('descricao').trim();
  const amount=cents(i.options.getNumber('preco'));
  requireThat(buyer && !buyer.bot && buyer.id!==i.user.id,'Escolha outro usuário humano como comprador.');
  requireThat(description.length>0 && description.length<=250,'Descrição inválida.');
  requireThat(amount>=100 && amount<=ctx.config.maxOrderCents,'Valor fora do limite configurado.');
  await i.guild.members.fetch(buyer.id);
  const id=`ord_${i.id}`;
  const existing=ctx.store.get(id);
  if(existing)return i.editReply({content:`Pedido já registrado: <#${existing.channel_id}>. Use /pedido-status.`});
  const permissions=[1024n,2048n,65536n]; // ViewChannel, SendMessages, ReadMessageHistory
  const channel=await i.guild.channels.create({name:`pedido-${i.id.slice(-12)}`,type:0,
    permissionOverwrites:[
      {id:i.guild.roles.everyone.id,deny:[1024n]},
      {id:ctx.client.user.id,allow:permissions},
      {id:buyer.id,allow:permissions},{id:i.user.id,allow:permissions},
      {id:ctx.config.staffRoleId,allow:permissions},
    ]});
  let order;
  try { order=ctx.store.create({id,guild_id:i.guildId,channel_id:channel.id,buyer_id:buyer.id,seller_id:i.user.id,description,amount_cents:amount}); }
  catch(error){await channel.delete('Pedido não foi registrado').catch(()=>{});throw error;}
  try { ctx.store.checkout(id,await ctx.mp.createPreference(order)); }
  catch { ctx.store.checkoutFailed(id);return i.editReply({content:`Pedido <#${channel.id}> exige conferência: checkout não confirmado. A staff foi notificada.`}); }
  return i.editReply({content:`Pedido criado em <#${channel.id}>. O link será publicado pela fila de notificações.`});
}
