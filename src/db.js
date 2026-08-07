import Database from "better-sqlite3";

const db = new Database("escrow.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,           -- id interno do pedido (ex: "ord_ab12cd")
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,      -- thread/canal privado da negociação
    buyer_id TEXT NOT NULL,        -- id do comprador no Discord
    seller_id TEXT NOT NULL,       -- id do vendedor no Discord
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, -- valor em centavos (evita erro de ponto flutuante)
    status TEXT NOT NULL,          -- aguardando_pagamento | pago | enviado | confirmado | disputa | liberado | cancelado
    mp_payment_id TEXT,            -- id do pagamento no Mercado Pago
    mp_preference_id TEXT,         -- id da preferência de checkout no Mercado Pago
    created_at TEXT NOT NULL,
    paid_at TEXT,
    released_at TEXT
  );
`);

export function createOrder(order) {
  db.prepare(`
    INSERT INTO orders (id, guild_id, channel_id, buyer_id, seller_id, description, amount_cents, status, created_at)
    VALUES (@id, @guild_id, @channel_id, @buyer_id, @seller_id, @description, @amount_cents, 'aguardando_pagamento', @created_at)
  `).run(order);
}

export function getOrder(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

export function getOrderByChannel(channelId) {
  return db.prepare(`SELECT * FROM orders WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1`).get(channelId);
}

export function getOrderByPreference(preferenceId) {
  return db.prepare(`SELECT * FROM orders WHERE mp_preference_id = ?`).get(preferenceId);
}

export function getOrderByPayment(paymentId) {
  return db.prepare(`SELECT * FROM orders WHERE mp_payment_id = ?`).get(paymentId);
}

export function setPreference(id, preferenceId) {
  db.prepare(`UPDATE orders SET mp_preference_id = ? WHERE id = ?`).run(preferenceId, id);
}

export function markPaid(id, paymentId) {
  db.prepare(`
    UPDATE orders SET status = 'pago', mp_payment_id = ?, paid_at = ?
    WHERE id = ?
  `).run(paymentId, new Date().toISOString(), id);
}

export function setStatus(id, status) {
  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, id);
}

export function markReleased(id) {
  db.prepare(`
    UPDATE orders SET status = 'liberado', released_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export default db;
