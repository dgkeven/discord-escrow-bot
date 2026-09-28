import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireThat, validatePayment, cents, canSettle } from './domain.js';

export class Store {
  constructor(path, config) {
    this.config = config;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, status TEXT NOT NULL, mp_payment_id TEXT,
        mp_preference_id TEXT, created_at TEXT NOT NULL, paid_at TEXT, released_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, order_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL,
        details TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), status TEXT NOT NULL,
        status_detail TEXT NOT NULL, amount_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL,
        release_status TEXT NOT NULL, valid INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
        checked_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, channel_id TEXT NOT NULL,
        content TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS payouts (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), operator TEXT NOT NULL, reference TEXT UNIQUE,
        operation_id TEXT UNIQUE NOT NULL, amount_cents INTEGER NOT NULL, state TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);
      CREATE INDEX IF NOT EXISTS orders_channel ON orders(channel_id);
      CREATE INDEX IF NOT EXISTS inbox_due ON inbox(done,next_at);
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(sent,next_at);
    `);
    try { this.transaction(() => {
      const columns = new Set(this.db.prepare('PRAGMA table_info(orders)').all().map(c => c.name));
      const additions = { version: 'INTEGER NOT NULL DEFAULT 0', checkout_url: 'TEXT', reconcile_at: 'INTEGER NOT NULL DEFAULT 0', legacy_review: 'INTEGER NOT NULL DEFAULT 0', reconcile_failures:'INTEGER NOT NULL DEFAULT 0' };
      const legacy = !columns.has('version');
      for (const [name, type] of Object.entries(additions)) {
        if (!columns.has(name)) this.db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
      }
      if (!this.db.prepare('PRAGMA table_info(outbox)').all().some(c=>c.name==='order_id')) this.db.exec('ALTER TABLE outbox ADD COLUMN order_id TEXT');
      if (legacy) {
        for (const order of this.db.prepare('SELECT * FROM orders').all()) {
          this.audit(order.id, 'migration', 'legacy_review', { previousStatus: order.status });
        }
        this.db.exec("UPDATE orders SET legacy_review=1, status='revisao'");
      }
      const environment = `${config.collectorId}:${config.liveMode}`;
      const existing = this.db.prepare("SELECT value FROM metadata WHERE key='environment'").get();
      requireThat(!existing || existing.value === environment, 'Banco pertence a outro recebedor/ambiente.');
      this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('environment', ?)").run(environment);
    }); } catch(error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  claimRuntime() {
    const owner = randomUUID();
    const now = Date.now();
    this.transaction(() => {
      const active = this.db.prepare('SELECT * FROM runtime WHERE id=1').get();
      requireThat(!active || active.expires < now, 'Outra instância usa este banco.');
      this.db.prepare('INSERT OR REPLACE INTO runtime VALUES (1,?,?)').run(owner, now + 60000);
    });
    this.owner = owner;
  }
  heartbeat() {
    const row = this.db.prepare('UPDATE runtime SET expires=? WHERE id=1 AND owner=? AND expires>?').run(Date.now()+60000, this.owner, Date.now());
    requireThat(row.changes === 1, 'Instância perdeu a exclusividade do banco.');
  }
  assertOwner() {
    if (!this.owner) return;
    const row = this.db.prepare('SELECT * FROM runtime WHERE id=1').get();
    requireThat(row?.owner === this.owner && row.expires > Date.now(), 'Instância inativa.');
  }
  close() {
    if (this.owner) this.db.prepare('DELETE FROM runtime WHERE owner=?').run(this.owner);
    this.db.close();
  }
  get(id) { return this.db.prepare('SELECT * FROM orders WHERE id=?').get(id); }
  byChannel(id) { return this.db.prepare('SELECT * FROM orders WHERE channel_id=? ORDER BY created_at DESC LIMIT 1').get(id); }
  audit(id, actor, action, details = {}) {
    this.db.prepare('INSERT INTO audit(order_id,actor,action,details,created_at) VALUES (?,?,?,?,?)')
      .run(id, actor, action, JSON.stringify(details), new Date().toISOString());
  }
  notify(key, channel, content, orderId=null) {
    this.db.prepare('INSERT OR IGNORE INTO outbox(dedupe,channel_id,content,order_id) VALUES (?,?,?,?)').run(key, channel, content,orderId);
  }
  announce(order, event, text) {
    this.notify(`${event}:order`, order.channel_id, text,order.id);
    this.notify(`${event}:staff`, this.config.staffChannelId, `[${order.id}] ${text}`,order.id);
  }
  create(order) {
    return this.transaction(() => {
      this.assertOwner();
      const open = this.db.prepare("SELECT count(*) n FROM orders WHERE seller_id=? AND status NOT IN ('repassado','reembolsado','cancelado')").get(order.seller_id).n;
      requireThat(open < this.config.maxOpenOrders, 'Limite de pedidos abertos atingido.');
      requireThat(Number.isSafeInteger(order.amount_cents) && order.amount_cents >= 100 && order.amount_cents <= this.config.maxOrderCents, 'Valor fora dos limites.');
      this.db.prepare(`INSERT INTO orders(id,guild_id,channel_id,buyer_id,seller_id,description,amount_cents,status,created_at)
        VALUES (?,?,?,?,?,?,?,'criando_checkout',?)`).run(order.id, order.guild_id, order.channel_id, order.buyer_id, order.seller_id, order.description, order.amount_cents, new Date().toISOString());
      this.audit(order.id, order.seller_id, 'created');
      return this.get(order.id);
    });
  }
  checkout(id, preference) {
    this.transaction(() => {
      this.assertOwner();
      const o = this.get(id);
      requireThat(o?.status === 'criando_checkout', 'Estado do checkout mudou.');
      this.db.prepare("UPDATE orders SET mp_preference_id=?,checkout_url=?,status='aguardando_pagamento',version=version+1 WHERE id=?")
        .run(preference.id, preference.url, id);
      this.audit(id, 'system', 'checkout_created', { preferenceId: preference.id });
      this.announce(o, `checkout:${id}`, `Pedido ${id}: ${o.description}\nValor: R$ ${(o.amount_cents/100).toFixed(2)}\nComprador: <@${o.buyer_id}> | Vendedor: <@${o.seller_id}>\nPagamento: ${preference.url}\nO recebedor é a conta da operação. Repasse e reembolso são manuais; não há garantia automática de custódia. Aguarde a confirmação do pagamento antes do envio.`);
    });
  }
  checkoutFailed(id) {
    this.transaction(() => {
      this.assertOwner();
      this.db.prepare("UPDATE orders SET status='falha_checkout',version=version+1 WHERE id=? AND status='criando_checkout'").run(id);
      this.audit(id, 'system', 'checkout_failed');
      const o = this.get(id);
      this.announce(o, `checkout-failed:${id}`, 'Falha ao criar checkout. Não pague nem recrie este pedido antes da conferência da staff. Use /pedido-status.');
    });
  }
  paymentRows(id) { return this.db.prepare('SELECT * FROM payments WHERE order_id=?').all(id); }
  paid(id, released = false) {
    const o = this.get(id);
    requireThat(o && !o.legacy_review, 'Pedido antigo exige migração e conferência humana documentada.');
    const rows = this.paymentRows(id);
    requireThat(rows.every(p => p.valid), 'Há pagamento divergente. Repasse bloqueado.');
    const active = rows.filter(p => !['rejected','cancelled','refunded'].includes(p.status));
    requireThat(active.length === 1 && active[0].status === 'approved' && active[0].refunded_cents === 0,
      'Exige exatamente um pagamento aprovado, sem reembolso ou outra tentativa pendente.');
    requireThat(!rows.some(p => ['charged_back','in_mediation'].includes(p.status)), 'Contestação bloqueia repasse.');
    if (released) requireThat(canSettle(active[0]), 'Saldo ainda não liberado pelo Mercado Pago.');
    return active[0];
  }
  recordPayment(payment) {
    return this.transaction(() => {
      this.assertOwner();
      const o = this.get(payment.external_reference);
      if (!o) {
        this.audit(null, 'mercadopago', 'unknown_order', { paymentId: String(payment.id) });
        this.notify(`unknown:${payment.id}`,this.config.staffChannelId,`Pagamento ${payment.id} sem pedido correspondente. Confira a conta Mercado Pago.`);
        return;
      }
      let valid = 1, reason = '';
      try { validatePayment(payment, o, this.config); } catch (err) { valid = 0; reason = err.message; }
      const id = String(payment.id);
      const previous = this.db.prepare('SELECT * FROM payments WHERE id=?').get(id);
      requireThat(!previous || previous.order_id === o.id, 'Pagamento já associado a outro pedido.');
      const updated = Date.parse(payment.date_last_updated);
      if (previous && Number.isFinite(updated) && updated < previous.updated_ms) return;
      let amount = 0, refunded = 0;
      try { amount = cents(payment.transaction_amount); refunded = cents(payment.transaction_amount_refunded ?? 0); }
      catch { valid = 0; reason = 'Valor inválido.'; }
      const row = { id, order_id:o.id, status:String(payment.status || 'unknown'), status_detail:String(payment.status_detail || ''),
        amount_cents:amount, refunded_cents:refunded, release_status:String(payment.money_release_status || ''), valid,
        updated_ms:Number.isFinite(updated)?updated:0, checked_at:Date.now() };
      const unchanged = previous && Object.keys(row).filter(k=>k!=='checked_at').every(k=>previous[k]===row[k]);
      if (unchanged) { this.db.prepare('UPDATE payments SET checked_at=? WHERE id=?').run(row.checked_at,id); return; }
      this.db.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,status_detail=excluded.status_detail,amount_cents=excluded.amount_cents,
        refunded_cents=excluded.refunded_cents,release_status=excluded.release_status,valid=excluded.valid,
        updated_ms=excluded.updated_ms,checked_at=excluded.checked_at`)
        .run(...Object.values(row));
      let status = o.status;
      const rows = this.paymentRows(o.id);
      const active = rows.filter(p=>!['rejected','cancelled','refunded'].includes(p.status));
      if (!valid || rows.some(p=>!p.valid) || active.length > 1) status='revisao';
      else if (rows.some(p=>p.status==='charged_back')) status='chargeback';
      else if (rows.some(p=>p.status==='in_mediation' || p.refunded_cents>0 && p.status!=='refunded')) status='revisao';
      else if (row.status==='refunded' && (o.mp_payment_id===id || !o.mp_payment_id) && !active.length) status='reembolsado';
      else if (active.length===1 && active[0].status==='approved') {
        if (['aguardando_pagamento','criando_checkout'].includes(status)) status='pago';
        if (['cancelado','falha_checkout','reembolsado'].includes(status) || o.mp_payment_id && o.mp_payment_id!==active[0].id) status='revisao';
      } else if (['pago','repasse_pendente','repasse_em_execucao','repassado'].includes(status)) status='revisao';
      if (o.legacy_review) status='revisao';
      this.db.prepare(`UPDATE orders SET status=?,mp_payment_id=COALESCE(mp_payment_id,?),
        paid_at=COALESCE(paid_at,?),version=version+1 WHERE id=?`).run(status,
        valid && row.status==='approved'?id:null, valid && row.status==='approved'?new Date().toISOString():null,o.id);
      this.audit(o.id,'mercadopago','payment_updated',{paymentId:id,status:row.status,valid,reason,orderStatus:status});
      this.announce(o, `payment:${id}:${this.get(o.id).version}`, `Pagamento ${id}: ${row.status}. Pedido: ${status}.${reason ? ` ${reason}` : ''}\n${status==='pago'?'Pagamento confirmado na conta da operação. Após receber, o comprador usa /confirmar-recebimento.':'Consulte /pedido-status. Não faça repasses quando houver bloqueio.'}`);
    });
  }
  transition(id, expected, allowed, next, actor, reason, { paid = false, released = false } = {}) {
    return this.transaction(() => {
      this.assertOwner();
      const o=this.get(id);
      requireThat(o && o.version===expected && allowed.includes(o.status), 'Pedido mudou ou não permite esta ação. Consulte /pedido-status.');
      if (['repasse_pendente','reembolso_pendente'].includes(next)) requireThat(!this.db.prepare('SELECT 1 FROM payouts WHERE order_id=?').get(id),'Já existe operação de repasse. Confira a reserva e o extrato antes de qualquer decisão.');
      if (paid) this.paid(id,released);
      this.db.prepare('UPDATE orders SET status=?,version=version+1 WHERE id=?').run(next,id);
      this.audit(id,actor,next,{reason,previousStatus:o.status});
      this.announce(o,`state:${id}:${o.version+1}`,`Pedido: ${next}. Responsável: <@${actor}>. ${reason}`);
      return this.get(id);
    });
  }
  reservePayout(id, expected, actor) {
    return this.transaction(() => {
      this.assertOwner();
      const o=this.get(id);
      requireThat(o?.version===expected && o.status==='repasse_pendente','Pedido não está autorizado para repasse.');
      this.paid(id,true);
      requireThat(!this.db.prepare('SELECT 1 FROM payouts WHERE order_id=?').get(id),'Repasse já reservado ou concluído. Não transfira novamente.');
      const operation=randomUUID();
      this.db.prepare("INSERT INTO payouts VALUES (?,?,NULL,?,?,'reservado',?,NULL)").run(id,actor,operation,o.amount_cents,new Date().toISOString());
      this.db.prepare("UPDATE orders SET status='repasse_em_execucao',version=version+1 WHERE id=?").run(id);
      this.audit(id,actor,'payout_reserved',{operation});
      this.announce(o,`payout-reserve:${id}`,`Repasse reservado exclusivamente por <@${actor}>. Operação ${operation}. Outros operadores não devem transferir.`);
      return operation;
    });
  }
  finishPayout(id, expected, actor, operation, reference) {
    return this.transaction(() => {
      this.assertOwner();
      const o=this.get(id), payout=this.db.prepare('SELECT * FROM payouts WHERE order_id=?').get(id);
      requireThat(o?.version===expected,'Estado mudou. Confira antes de registrar.');
      requireThat(payout?.state==='reservado' && payout.operator===actor && payout.operation_id===operation,'Operação ou operador incorreto.');
      requireThat(typeof reference==='string' && /^[A-Za-z0-9._:-]{8,120}$/.test(reference),'Informe o identificador bancário do comprovante (8 a 120 caracteres).');
      // This is a statement about a transfer ALREADY made. Never hide that fact
      // because a refund/chargeback arrived or the provider is currently offline.
      requireThat(!this.db.prepare('SELECT 1 FROM payouts WHERE reference=?').get(reference),'Comprovante já utilizado.');
      const now=new Date().toISOString();
      this.db.prepare("UPDATE payouts SET state='registrado',reference=?,completed_at=? WHERE order_id=?").run(reference,now,id);
      const status=o.status==='repasse_em_execucao'?'repassado':o.status;
      this.db.prepare('UPDATE orders SET status=?,released_at=?,version=version+1 WHERE id=?').run(status,now,id);
      this.audit(id,actor,'payout_recorded',{operation,reference});
      this.announce(o,`payout-done:${id}`,`Staff <@${actor}> registrou repasse manual concluído. Comprovante: ${reference}. Estado atual: ${status}. Este registro não é uma confirmação bancária automática.`);
    });
  }
  enqueue(id,paymentId) { this.assertOwner(); this.db.prepare('INSERT OR IGNORE INTO inbox(id,payment_id) VALUES (?,?)').run(id,paymentId); }
  due(table,limit=10) {
    requireThat(['inbox','outbox'].includes(table),'Fila inválida.');
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${table==='inbox'?'done':'sent'}=0 AND next_at<=? ORDER BY next_at,id LIMIT ?`).all(Date.now(),limit);
  }
  finish(table,id) {
    requireThat(['inbox','outbox'].includes(table),'Fila inválida.');
    this.db.prepare(`UPDATE ${table} SET ${table==='inbox'?'done':'sent'}=1 WHERE id=?`).run(id);
  }
  retry(table,row) {
    requireThat(['inbox','outbox'].includes(table),'Fila inválida.');
    this.db.prepare(`UPDATE ${table} SET attempts=attempts+1,next_at=? WHERE id=?`).run(Date.now()+Math.min(3600000,1000*2**Math.min(row.attempts,12)),row.id);
    if (row.attempts===4) this.notify(`queue:${table}:${row.id}`,this.config.staffChannelId,`Falha persistente na fila ${table}, item ${row.id}. Verifique logs e /healthz. As tentativas continuam.`);
  }
  schedule(id,delay=300000,failed=false) { this.db.prepare(`UPDATE orders SET reconcile_at=?,reconcile_failures=${failed?'reconcile_failures+1':'0'} WHERE id=?`).run(Date.now()+delay,id); }
  dueOrders() { return this.db.prepare('SELECT * FROM orders WHERE reconcile_at<=? ORDER BY reconcile_at LIMIT 5').all(Date.now()); }
  reminders() {
    const limit=new Date(Date.now()-this.config.reminderDays*86400000).toISOString();
    for (const o of this.db.prepare("SELECT * FROM orders WHERE paid_at<=? AND status IN ('pago','disputa','repasse_pendente','repasse_em_execucao','reembolso_pendente','revisao')").all(limit)) {
      this.notify(`reminder:${o.id}:${new Date().toISOString().slice(0,10)}`,this.config.staffChannelId,`Pedido ${o.id} aguardando ação: ${o.status}. Prazo excedido; nunca liberar automaticamente.`);
    }
  }
  health() {
    return { pendingPayments:this.db.prepare('SELECT count(*) n FROM inbox WHERE done=0').get().n,
      pendingMessages:this.db.prepare('SELECT count(*) n FROM outbox WHERE sent=0').get().n,
      failingJobs:this.db.prepare('SELECT (SELECT count(*) FROM inbox WHERE done=0 AND attempts>=5)+(SELECT count(*) FROM outbox WHERE sent=0 AND attempts>=5)+(SELECT count(*) FROM orders WHERE reconcile_failures>=5) n').get().n };
  }
}
