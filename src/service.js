import { requireThat } from './domain.js';

export class Service {
  constructor(store, mp) { this.store=store; this.mp=mp; this.locks=new Map(); }
  async lock(id, action) {
    const previous=this.locks.get(id) || Promise.resolve();
    const current=previous.catch(()=>{}).then(action);
    this.locks.set(id,current);
    try { return await current; }
    finally { if(this.locks.get(id)===current)this.locks.delete(id); }
  }
  async refreshUnlocked(id) {
    const order=this.store.get(id);
    requireThat(order,'Pedido inexistente.');
    // Search detects additional payments even if their webhook was lost.
    const found=await this.mp.searchPayments(id);
    const ids=new Set([...found.map(p=>String(p.id)),...this.store.paymentRows(id).map(p=>p.id)]);
    if(order.mp_payment_id)ids.add(order.mp_payment_id);
    for(const paymentId of ids) {
      const payment=await this.mp.getPayment(paymentId);
      requireThat(payment.external_reference===id,'Pagamento retornou referência divergente.');
      this.store.recordPayment(payment);
    }
    this.store.schedule(id);
    return this.store.get(id);
  }
  refresh(id) { return this.lock(id,()=>this.refreshUnlocked(id)); }
  async processPayment(id) {
    const payment=await this.mp.getPayment(id);
    requireThat(String(payment.id)===String(id),'API retornou outro pagamento.');
    return this.lock(payment.external_reference,async()=>{
      const current=await this.mp.getPayment(id);
      requireThat(String(current.id)===String(id) && current.external_reference===payment.external_reference,'Pagamento mudou de referência.');
      return this.store.recordPayment(current);
    });
  }
  action(id, fn) { return this.lock(id,async()=>fn(await this.refreshUnlocked(id))); }
}
