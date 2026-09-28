import { definition, stringOption, orderFor, staffFor, isStaff } from './common.js';
import { requireThat, money } from '../domain.js';
export const commands=[
  {data:definition('pedido-status','Consulta o estado, pagamento e operação pendente'),async execute(i,ctx){
    const o=orderFor(i,ctx);
    requireThat(isStaff(i,ctx)||[o.buyer_id,o.seller_id].includes(i.user.id),'Sem acesso ao pedido.');
    const payout=ctx.store.db.prepare('SELECT * FROM payouts WHERE order_id=?').get(o.id);
    const payments=ctx.store.paymentRows(o.id);
    return i.editReply({content:`Pedido ${o.id}\nEstado: ${o.status}\nValor: ${money(o.amount_cents)}\nPagamentos: ${payments.slice(0,10).map(p=>`${p.id}: ${p.status}`).join(', ')||'nenhum confirmado'}${payments.length>10?` (e mais ${payments.length-10})`:''}${payout?`\nOperação: ${payout.operation_id}; operador: ${payout.operator}; estado: ${payout.state}`:''}${o.status==='aguardando_pagamento'&&o.checkout_url?`\nCheckout: ${o.checkout_url}`:''}\nRepasse e reembolso são manuais. Dados refletem a última conciliação.`});
  }},
  {data:definition('reconciliar-pedido','Staff: consulta pagamentos e atualiza este pedido'),async execute(i,ctx){
    const o=orderFor(i,ctx);requireThat(isStaff(i,ctx),'Somente staff.');
    const fresh=await ctx.service.refresh(o.id);
    return i.editReply({content:`Conciliação concluída: ${fresh.status}.`});
  }},
  {data:definition('preparar-repasse','Staff: reserva a operação antes de transferir dinheiro'),async execute(i,ctx){
    const order=orderFor(i,ctx);staffFor(i,ctx,order);
    const operation=await ctx.service.action(order.id,o=>ctx.store.reservePayout(o.id,o.version,i.user.id));
    return i.editReply({content:`Operação ${operation} reservada exclusivamente para você. Confira o beneficiário do vendedor <@${order.seller_id}> e transfira ${money(order.amount_cents)} uma única vez. Taxas são custeadas pela operação. Registre o identificador do comprovante em /registrar-repasse. Se houver timeout bancário, confira o extrato antes de qualquer nova tentativa.`});
  }},
  {data:definition('registrar-repasse','Staff: registra transferência já executada, sem transferir novamente',[
    stringOption('operacao','ID retornado por /preparar-repasse'),stringOption('comprovante','Identificador bancário da transferência (sem dados pessoais)',true,{min_length:8,max_length:120}),
  ]),async execute(i,ctx){
    const order=orderFor(i,ctx);staffFor(i,ctx,order);
    ctx.store.finishPayout(order.id,order.version,i.user.id,i.options.getString('operacao'),i.options.getString('comprovante'));
    return i.editReply({content:'Repasse manual registrado na auditoria. Não execute outra transferência.'});
  }},
  {data:definition('cancelar-pedido','Staff: encerra negociação não paga; pagamentos tardios exigem revisão',[
    stringOption('motivo','Justificativa para auditoria',true,{min_length:5,max_length:500}),
  ]),async execute(i,ctx){
    const order=orderFor(i,ctx);staffFor(i,ctx,order);
    await ctx.service.action(order.id,o=>{
      requireThat(ctx.store.paymentRows(o.id).every(p=>p.valid && ['rejected','cancelled','pending','in_process'].includes(p.status)),'Há pagamento ou divergência; confira reembolso.');
      ctx.store.transition(o.id,o.version,['aguardando_pagamento','falha_checkout','disputa'],'cancelado',i.user.id,i.options.getString('motivo'));
    });
    return i.editReply({content:'Negociação encerrada no bot. Isso não cancela um pagamento no Mercado Pago. Não use o link antigo; pagamentos tardios serão bloqueados para revisão.'});
  }},
];
