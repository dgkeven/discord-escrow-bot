export class MercadoPago {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; }
  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetch(`https://api.mercadopago.com${path}`, {
      method, headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Mercado Pago HTTP ${response.status}`);
    return response.json();
  }
  async verifyAccount() {
    const account = await this.request('/users/me');
    if (String(account.id) !== this.config.collectorId) throw new Error('MP_COLLECTOR_ID não corresponde ao token.');
  }
  getPayment(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('ID inválido.');
    return this.request(`/v1/payments/${id}`);
  }
  async searchPayments(orderId) {
    const payments = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      const query = new URLSearchParams({ external_reference: orderId, limit: '50', offset: String(offset), sort: 'date_created', criteria: 'desc' });
      const page = await this.request(`/v1/payments/search?${query}`);
      if (!Array.isArray(page.results) || !Number.isSafeInteger(page.paging?.total)) throw new Error('Resposta de busca inválida.');
      payments.push(...page.results);
      if (offset + 50 >= page.paging.total) return payments;
    }
    throw new Error('Muitos pagamentos para o pedido: revisão necessária.');
  }
  async createPreference(order) {
    // No POST retry: an ambiguous timeout requires manual reconciliation.
    const notification = new URL(this.config.webhookUrl);
    notification.searchParams.set('source_news', 'webhooks');
    const result = await this.request('/checkout/preferences', { method: 'POST', body: {
      items: [{ id: order.id, title: order.description, quantity: 1, unit_price: order.amount_cents / 100, currency_id: 'BRL' }],
      external_reference: order.id, notification_url: notification.href,
      back_urls: { success: this.config.successUrl, pending: this.config.successUrl, failure: this.config.successUrl },
      auto_return: 'approved', statement_descriptor: 'PEDIDO DISCORD',
      expires: true, expiration_date_from:new Date(Date.now()-60000).toISOString(), expiration_date_to: new Date(Date.now() + 86400000).toISOString(),
    } });
    const checkoutUrl = this.config.liveMode ? result.init_point : result.sandbox_init_point;
    if (!result.id || !checkoutUrl || new URL(checkoutUrl).protocol !== 'https:') throw new Error('Checkout retornado inválido.');
    return { id: String(result.id), url: checkoutUrl };
  }
}
