import { requireThat } from '../domain.js';
import { definition, stringOption, orderFor } from './common.js';
export const data=definition('abrir-disputa','Bloqueia o repasse e solicita análise da staff',[stringOption('motivo','Descreva o problema',true,{min_length:5,max_length:500})]);
export async function execute(i,ctx) {
  const o=orderFor(i,ctx);
  requireThat([o.buyer_id,o.seller_id].includes(i.user.id),'Só participantes podem abrir disputa.');
  const reason=i.options.getString('motivo');
  // No network prerequisite: a participant must be able to block a payout during an outage.
  ctx.store.transition(o.id,o.version,['aguardando_pagamento','pago','repasse_pendente'],'disputa',i.user.id,reason);
  return i.editReply({content:'Disputa registrada. Repasse bloqueado até decisão da staff.'});
}
