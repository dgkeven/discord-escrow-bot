import { definition, stringOption, orderFor, staffFor } from './common.js';
export const data=definition('liberar-manual','Staff: autoriza repasse ou solicita reembolso; não movimenta dinheiro',[
  stringOption('decisao','Decisão',true,{choices:[{name:'Autorizar repasse',value:'liberar'},{name:'Solicitar reembolso',value:'cancelar'}]}),
  stringOption('motivo','Justificativa para auditoria',true,{min_length:5,max_length:500}),
]);
export async function execute(i,ctx) {
  const order=orderFor(i,ctx);staffFor(i,ctx,order);
  const release=i.options.getString('decisao')==='liberar';
  await ctx.service.action(order.id,o=>ctx.store.transition(o.id,o.version,release?['disputa','revisao']:['pago','disputa','repasse_pendente','revisao'],release?'repasse_pendente':'reembolso_pendente',i.user.id,i.options.getString('motivo'),{paid:true}));
  return i.editReply({content:release?'Repasse autorizado. Use /preparar-repasse antes de transferir.':'Reembolso solicitado. Faça o reembolso no painel Mercado Pago; o bot só confirma após consultar a API.'});
}
