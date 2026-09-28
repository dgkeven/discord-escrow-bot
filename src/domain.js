export class UserError extends Error {}
export function requireThat(condition, message) { if (!condition) throw new UserError(message); }
export function cents(value) {
  const number = Number(value);
  const result = Math.round(number * 100);
  requireThat(Number.isFinite(number) && Number.isSafeInteger(result) && number >= 0 && Math.abs(number * 100 - result) < 0.000001,
    'Valor inválido: use no máximo duas casas decimais.');
  return result;
}
export const money = (value) => `R$ ${(value / 100).toFixed(2)}`;
export function validatePayment(payment, order, config) {
  requireThat(/^\d+$/.test(String(payment.id)), 'ID de pagamento inválido.');
  requireThat(payment.external_reference === order.id, 'Referência do pagamento divergente.');
  requireThat(String(payment.collector_id) === config.collectorId, 'Recebedor do pagamento divergente.');
  requireThat(payment.live_mode === config.liveMode, 'Ambiente do pagamento divergente.');
  requireThat(payment.currency_id === 'BRL' && cents(payment.transaction_amount) === order.amount_cents,
    'Valor ou moeda do pagamento divergente.');
  requireThat(Number.isFinite(Date.parse(payment.date_last_updated)), 'Pagamento sem data de atualização válida.');
}
export function canSettle(payment) {
  return payment?.status === 'approved' && payment.status_detail === 'accredited'
    && payment.refunded_cents === 0 && payment.release_status === 'released';
}
