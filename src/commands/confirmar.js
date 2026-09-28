import { requireThat } from '../domain.js';
import { definition, orderFor } from './common.js';
export const data=definition('confirmar-recebimento','Confirma recebimento e autoriza análise do repasse manual');
export async function execute(i,ctx) {
  const order=orderFor(i,ctx);
  requireThat(order.buyer_id===i.user.id,'Só o comprador pode confirmar.');
  await ctx.service.action(order.id,o=>ctx.store.transition(o.id,o.version,['pago'],'repasse_pendente',i.user.id,'Comprador confirmou recebimento; nenhum dinheiro foi transferido.',{paid:true}));
  return i.editReply({content:'Recebimento confirmado. A staff precisa conferir e executar o repasse manual.'});
}
