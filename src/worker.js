export function createWorker({ store, service, send }) {
  let running=false, stopped=false;
  async function tick() {
    if(running || stopped)return;
    running=true;
    try {
      store.assertOwner();
      for(const row of store.due('inbox')) {
        try { await service.processPayment(row.payment_id);store.finish('inbox',row.id); }
        catch { store.retry('inbox',row);console.error(JSON.stringify({event:'payment_retry',paymentId:row.payment_id})); }
      }
      for(const order of store.dueOrders()) {
        try { await service.refresh(order.id); }
        catch { store.schedule(order.id,60000,true);store.notify(`reconcile-failed:${order.id}:${new Date().toISOString().slice(0,10)}`,store.config.staffChannelId,`Não foi possível reconciliar ${order.id}. Repasse exige consulta atualizada; verifique o Mercado Pago.`); }
      }
      store.reminders();
      for(const row of store.due('outbox',20)) {
        try {
          const order=row.order_id?store.get(row.order_id):null;
          // Never publish an old checkout after payment or cancellation.
          if(order && row.dedupe.startsWith('checkout:') && order.status!=='aguardando_pagamento'){store.finish('outbox',row.id);continue;}
          const message=order?{...row,content:`${row.content}\n\nEstado atual na entrega deste aviso: **${order.status}**. Consulte /pedido-status antes de agir.`}:row;
          store.assertOwner();await send(message);store.finish('outbox',row.id);
        }
        catch { store.retry('outbox',row); }
      }
    } finally { running=false; }
  }
  return { tick, stop(){stopped=true;}, get running(){return running;} };
}
