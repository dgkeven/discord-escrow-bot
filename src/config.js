import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function loadConfig(env = process.env) {
  const required = (key) => {
    const value = env[key]?.trim();
    if (!value || /SUBSTITUA|coloque_|seu-dominio/i.test(value)) throw new Error(`Configure ${key}.`);
    return value;
  };
  const id = (key) => {
    const value = required(key);
    if (!/^\d{5,22}$/.test(value)) throw new Error(`${key} inválido.`);
    return value;
  };
  const bool = (key) => {
    if (!['true', 'false'].includes(env[key] ?? 'false')) throw new Error(`${key}: use true ou false.`);
    return env[key] === 'true';
  };
  const integer = (key, fallback, min, max) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} inválido.`);
    return n;
  };
  const https = (key) => {
    const url = new URL(required(key));
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${key} exige HTTPS.`);
    return url.href;
  };
  const liveMode = bool('MP_LIVE_MODE');
  if (liveMode && !bool('ENABLE_REAL_PAYMENTS')) throw new Error('Produção bloqueada: ENABLE_REAL_PAYMENTS=false.');
  if (!env.DATABASE_PATH && existsSync('escrow.sqlite')) throw new Error('Banco antigo encontrado. Faça backup e configure DATABASE_PATH=./escrow.sqlite.');
  return {
    token: required('DISCORD_TOKEN'), clientId: id('DISCORD_CLIENT_ID'), guildId: id('DISCORD_GUILD_ID'),
    staffRoleId: id('STAFF_ROLE_ID'), staffChannelId: id('STAFF_CHANNEL_ID'),
    accessToken: required('MP_ACCESS_TOKEN'), webhookSecret: required('MP_WEBHOOK_SECRET'),
    collectorId: id('MP_COLLECTOR_ID'), webhookUrl: https('MP_WEBHOOK_URL'), successUrl: https('MP_SUCCESS_URL'),
    liveMode, databasePath: resolve(env.DATABASE_PATH || './data/escrow.sqlite'),
    host: env.HOST || '127.0.0.1', port: integer('PORT', 3000, 1, 65535),
    maxOrderCents: integer('MAX_ORDER_CENTS', 100000, 100, 100000000),
    maxOpenOrders: integer('MAX_OPEN_ORDERS', 3, 1, 100),
    reminderDays: integer('PRAZO_CONFIRMACAO_DIAS', 3, 1, 90),
  };
}
