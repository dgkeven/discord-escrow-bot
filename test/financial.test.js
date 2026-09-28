import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/db.js';
import { Service } from '../src/service.js';
import { verifyWebhook } from '../src/webhook.js';
import { createWorker } from '../src/worker.js';
import { createWebhookServer } from '../src/server.js';
import { cents } from '../src/domain.js';
import { loadConfig } from '../src/config.js';
import { MercadoPago } from '../src/mercadopago.js';
import * as vender from '../src/commands/vender.js';
import * as confirmar from '../src/commands/confirmar.js';
import * as disputa from '../src/commands/disputa.js';
import * as liberar from '../src/commands/liberar.js';
import { commands as operationCommands } from '../src/commands/operacao.js';

const config={collectorId:'99999',liveMode:false,staffChannelId:'staff',staffRoleId:'staff-role',guildId:'guild',maxOpenOrders:3,maxOrderCents:100000,reminderDays:3,webhookSecret:'test-only-secret'};
const makePayment=(extra={})=>({id:123,external_reference:'ord_test',collector_id:99999,live_mode:false,currency_id:'BRL',transaction_amount:150,status:'approved',status_detail:'accredited',transaction_amount_refunded:0,money_release_status:'released',date_last_updated:'2026-09-28T12:00:00Z',...extra});
function fixture(t,path=':memory:') {
  const store=new Store(path,config);t.after(()=>store.close());
  store.create({id:'ord_test',guild_id:'guild',channel_id:'channel',buyer_id:'buyer',seller_id:'seller',description:'Camiseta',amount_cents:15000});
  store.checkout('ord_test',{id:'pref',url:'https://example.com/checkout'});
  return store;
}
function interaction(user,options={}) {return {user:{id:user},guildId:'guild',channelId:'channel',options:{getString:k=>options[k]},memberPermissions:{has:()=>user==='staff'},editReply:async payload=>payload};}
function serviceFor(store,payments=[makePayment()]) {
  return new Service(store,{searchPayments:async()=>payments,getPayment:async id=>payments.find(p=>String(p.id)===String(id))});
}
function signed(id='123') {
  const requestId='request-id',ts='1704908010';
  const signature=createHmac('sha256',config.webhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return {url:new URL(`https://example.com/webhooks/mercadopago?data.id=${id}`),headers:{'x-signature':`ts=${ts},v1=${signature}`,'x-request-id':requestId},body:{type:'payment',data:{id}}};
}

test('Valores devem ter centavos exatos e limites',()=>{
  assert.equal(cents(150.90),15090);assert.equal(cents(0.29),29);
  for(const value of [0.001,NaN,Infinity,-1,1.001,1e20])assert.throws(()=>cents(value));
});
test('Assinatura verifica URL assinada e correspondência do corpo',()=>{
  const request=signed();assert.ok(verifyWebhook(request,config.webhookSecret));
  assert.equal(verifyWebhook(request,'wrong'),null);
  request.body.data.id='456';assert.equal(verifyWebhook(request,config.webhookSecret),null);
});
test('Assinatura rejeita parâmetros duplicados, digest truncado e headers ausentes',()=>{
  const request=signed();request.url.searchParams.append('data.id','123');assert.equal(verifyWebhook(request,config.webhookSecret),null);
  const other=signed();other.headers['x-signature']='ts=1704908010,v1=abc';assert.equal(verifyWebhook(other,config.webhookSecret),null);
  assert.equal(verifyWebhook({...signed(),headers:{}},config.webhookSecret),null);
});
test('Webhook aceita entrega antiga autêntica e deduplica em armazenamento',t=>{
  const store=fixture(t),event=verifyWebhook(signed(),config.webhookSecret);
  store.enqueue(event.eventId,event.paymentId);store.enqueue(event.eventId,event.paymentId);
  assert.equal(store.due('inbox').length,1);
});
test('Confirmação repetida de pagamento não reabre pedido nem duplica auditoria',t=>{
  const store=fixture(t);store.recordPayment(makePayment());
  const o=store.get('ord_test');assert.equal(o.status,'pago');
  store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
  const before=store.db.prepare('SELECT count(*) n FROM audit').get().n;
  store.recordPayment(makePayment());
  assert.equal(store.get(o.id).status,'repasse_pendente');assert.equal(store.db.prepare('SELECT count(*) n FROM audit').get().n,before);
});
for(const [field,value] of [['transaction_amount',1],['currency_id','USD'],['collector_id',88888],['live_mode',true]]) {
  test(`Pagamento com ${field} divergente bloqueia repasse`,t=>{
    const store=fixture(t);store.recordPayment(makePayment({[field]:value}));
    assert.equal(store.get('ord_test').status,'revisao');assert.throws(()=>store.paid('ord_test'));
  });
}
test('Pagamento durante disputa é registrado sem remover bloqueio',t=>{
  const store=fixture(t),o=store.get('ord_test');
  store.transition(o.id,o.version,['aguardando_pagamento'],'disputa','buyer','problema');store.recordPayment(makePayment());
  assert.equal(store.get(o.id).status,'disputa');assert.equal(store.paymentRows(o.id).length,1);
});
test('Não autoriza liberação manual sem pagamento',async t=>{
  const store=fixture(t),o=store.get('ord_test');
  store.transition(o.id,o.version,['aguardando_pagamento'],'disputa','buyer','problema');
  await assert.rejects(()=>liberar.execute(interaction('staff',{decisao:'liberar',motivo:'Conferido'}),{store,config,service:serviceFor(store,[])}));
  assert.equal(store.get(o.id).status,'disputa');
});
test('Somente comprador confirma; confirmação autoriza mas não registra transferência',async t=>{
  const store=fixture(t),ctx={store,config,service:serviceFor(store)};
  await assert.rejects(()=>confirmar.execute(interaction('seller'),ctx));
  await confirmar.execute(interaction('buyer'),ctx);
  assert.equal(store.get('ord_test').status,'repasse_pendente');assert.equal(store.get('ord_test').released_at,null);
});
test('Participante staff não pode decidir seu próprio pedido',async t=>{
  const store=fixture(t),i=interaction('seller',{decisao:'liberar',motivo:'Teste'});i.memberPermissions.has=()=>true;
  await assert.rejects(()=>liberar.execute(i,{store,config}),/próprio/);
});
test('Dois pagamentos aprovados ou uma tentativa pendente bloqueiam repasse',t=>{
  const store=fixture(t);store.recordPayment(makePayment());store.recordPayment(makePayment({id:124,status:'pending'}));
  assert.equal(store.get('ord_test').status,'revisao');assert.throws(()=>store.paid('ord_test'));
  store.recordPayment(makePayment({id:124}));assert.throws(()=>store.paid('ord_test'));
});
test('Reembolso parcial bloqueia; total é confirmado pela API',t=>{
  const store=fixture(t);store.recordPayment(makePayment());
  store.recordPayment(makePayment({transaction_amount_refunded:10,date_last_updated:'2026-09-28T13:00:00Z'}));
  assert.equal(store.get('ord_test').status,'revisao');assert.throws(()=>store.paid('ord_test'));
  store.recordPayment(makePayment({status:'refunded',transaction_amount_refunded:150,date_last_updated:'2026-09-28T14:00:00Z'}));
  assert.equal(store.get('ord_test').status,'reembolsado');
});
test('Chargeback não é sobrescrito por consulta antiga de approved',t=>{
  const store=fixture(t);store.recordPayment(makePayment());
  store.recordPayment(makePayment({status:'charged_back',date_last_updated:'2026-09-28T13:00:00Z'}));
  store.recordPayment(makePayment());assert.equal(store.get('ord_test').status,'chargeback');
});
test('Saldo não liberado impede preparação de repasse',t=>{
  const store=fixture(t);store.recordPayment(makePayment({money_release_status:'pending'}));
  const o=store.get('ord_test');store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
  assert.throws(()=>store.reservePayout(o.id,store.get(o.id).version,'staff'),/Saldo/);
});
test('Reserva é única, comprovante e operador são obrigatórios',t=>{
  const store=fixture(t);store.recordPayment(makePayment());let o=store.get('ord_test');
  store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});o=store.get(o.id);
  const op=store.reservePayout(o.id,o.version,'staff');
  assert.throws(()=>store.reservePayout(o.id,o.version,'other'));
  assert.throws(()=>store.finishPayout(o.id,store.get(o.id).version,'other',op,'bank-ref-123'));
  store.finishPayout(o.id,store.get(o.id).version,'staff',op,'bank-ref-123');
  assert.equal(store.get(o.id).status,'repassado');
  assert.throws(()=>store.finishPayout(o.id,store.get(o.id).version,'staff',op,'bank-ref-123'));
});
test('Versão impede ação sobre estado modificado por disputa',t=>{
  const store=fixture(t);store.recordPayment(makePayment());const o=store.get('ord_test');
  store.transition(o.id,o.version,['pago'],'disputa','buyer','problema');
  assert.throws(()=>store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true}));
});
test('Disputa continua disponível mesmo sem Mercado Pago',async t=>{
  const store=fixture(t);await disputa.execute(interaction('buyer',{motivo:'Não recebi'}),{store,config});
  assert.equal(store.get('ord_test').status,'disputa');
});
test('Fila repete consulta após falha; não perde evento',async t=>{
  const store=fixture(t);store.enqueue('event','123');
  const worker=createWorker({store,service:{processPayment:async()=>{throw Error('offline')},refresh:async()=>{}},send:async()=>{}});
  await worker.tick();const row=store.db.prepare('SELECT * FROM inbox').get();
  assert.equal(row.done,0);assert.equal(row.attempts,1);assert.ok(row.next_at>Date.now());
});
test('Falha do Discord não desfaz pagamento e mensagem permanece na fila',async t=>{
  const store=fixture(t);store.enqueue('event','123');
  const worker=createWorker({store,service:serviceFor(store),send:async()=>{throw Error('offline')}});
  await worker.tick();assert.equal(store.get('ord_test').status,'pago');
  assert.ok(store.health().pendingMessages>0);assert.equal(store.health().pendingPayments,0);
});
test('Conciliação descobre pagamento sem webhook',async t=>{
  const store=fixture(t);await serviceFor(store).refresh('ord_test');assert.equal(store.get('ord_test').status,'pago');
});
test('Preparações concorrentes geram somente uma reserva',async t=>{
  const store=fixture(t),service=serviceFor(store);await service.refresh('ord_test');
  let o=store.get('ord_test');store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
  const results=await Promise.allSettled(['staff','other'].map(actor=>service.action(o.id,fresh=>store.reservePayout(o.id,fresh.version,actor))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('Reinício conserva filas, pagamentos e comprovantes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'escrow-test-')),path=join(dir,'test.sqlite');
  let store;
  try {
    store=new Store(path,config);store.enqueue('event','123');store.close();
    store=new Store(path,config);assert.equal(store.due('inbox').length,1);store.close();store=null;
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('Banco não pode ser reutilizado em outro ambiente',()=>{
  const dir=mkdtempSync(join(tmpdir(),'escrow-env-')),path=join(dir,'test.sqlite');
  const store=new Store(path,config);store.close();
  assert.throws(()=>new Store(path,{...config,liveMode:true}),/outro/);
  rmSync(dir,{recursive:true,force:true});
});
test('Migração preserva pedido antigo e bloqueia repasse',()=>{
  const dir=mkdtempSync(join(tmpdir(),'escrow-migration-')),path=join(dir,'test.sqlite');
  const old=new DatabaseSync(path);
  old.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,guild_id TEXT,channel_id TEXT,buyer_id TEXT,seller_id TEXT,description TEXT,amount_cents INTEGER,status TEXT,mp_payment_id TEXT,mp_preference_id TEXT,created_at TEXT,paid_at TEXT,released_at TEXT);
    INSERT INTO orders VALUES ('old','g','c','b','s','x',100,'liberado',NULL,NULL,'2026-01-01',NULL,NULL)`);old.close();
  const store=new Store(path,config);
  assert.equal(store.get('old').status,'revisao');assert.equal(store.get('old').legacy_review,1);
  assert.ok(store.db.prepare("SELECT * FROM audit WHERE action='legacy_review'").get());store.close();rmSync(dir,{recursive:true,force:true});
});
test('Outra instância não pode adquirir o banco',t=>{
  const store=fixture(t);store.claimRuntime();assert.throws(()=>store.claimRuntime(),/Outra/);
});
test('HTTP só confirma após persistir e recusa assinatura inválida',async t=>{
  const store=fixture(t),server=createWebhookServer({store,config});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=signed(),url=`http://127.0.0.1:${server.address().port}/webhooks/mercadopago?data.id=123`;
  const response=await fetch(url,{method:'POST',headers:{...request.headers,'content-type':'application/json'},body:JSON.stringify(request.body)});
  assert.equal(response.status,200);assert.equal(store.due('inbox').length,1);
  const bad=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request.body)});assert.equal(bad.status,401);
  store.enqueue=()=>{throw Error('disk full')};
  const failed=await fetch(url,{method:'POST',headers:{...request.headers,'content-type':'application/json'},body:JSON.stringify(request.body)});assert.equal(failed.status,503);
});
test('Checkout inclui permissão explícita do bot; falha preserva pedido para análise',async t=>{
  const store=new Store(':memory:',config);t.after(()=>store.close());let overwrites;
  const i={id:'123456',user:{id:'seller'},guildId:'guild',guild:{roles:{everyone:{id:'everyone'}},members:{fetch:async()=>({})},channels:{create:async payload=>{overwrites=payload.permissionOverwrites;return{id:'channel',delete:async()=>{}}}}},options:{getUser:()=>({id:'buyer',bot:false}),getString:()=> 'Camiseta',getNumber:()=>150},editReply:async()=>{}};
  await vender.execute(i,{store,config,client:{user:{id:'bot'}},mp:{createPreference:async()=>{throw Error('offline')}}});
  assert.ok(overwrites.find(o=>o.id==='bot').allow.includes(1024n));assert.equal(store.get('ord_123456').status,'falha_checkout');
});
test('Cliente MP trata falha sem expor corpo nem repetir POST',async()=>{
  let calls=0;const mp=new MercadoPago({accessToken:'private'},async()=>{calls++;return {ok:false,status:500,json:async()=>({secret:'private'})}});
  await assert.rejects(()=>mp.request('/checkout/preferences',{method:'POST',body:{}}),/^Error: Mercado Pago HTTP 500$/);assert.equal(calls,1);
});
test('Produção exige opt-in explícito e configuração completa',()=>{
  assert.throws(()=>loadConfig({MP_LIVE_MODE:'true'}),/Produção bloqueada/);
  assert.throws(()=>loadConfig({}),/Configure/);
});
test('Comprovante de transferência já feita é preservado após chargeback',t=>{
  const store=fixture(t);store.recordPayment(makePayment());let o=store.get('ord_test');
  store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
  const op=store.reservePayout(o.id,store.get(o.id).version,'staff');
  store.recordPayment(makePayment({status:'charged_back',date_last_updated:'2026-09-28T14:00:00Z'}));
  store.finishPayout(o.id,store.get(o.id).version,'staff',op,'bank-ref-abc');
  assert.equal(store.get(o.id).status,'chargeback');
  assert.equal(store.db.prepare('SELECT reference FROM payouts').get().reference,'bank-ref-abc');
});
test('Repasse reservado impede nova autorização e reembolso concorrente',t=>{
  const store=fixture(t);store.recordPayment(makePayment());let o=store.get('ord_test');
  store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
  store.reservePayout(o.id,store.get(o.id).version,'staff');
  store.recordPayment(makePayment({id:124}));o=store.get(o.id);
  assert.throws(()=>store.transition(o.id,o.version,['revisao'],'reembolso_pendente','staff','cancelar',{paid:true}),/operação/);
});
test('Checkout antigo não é enviado após pagamento',async t=>{
  const store=fixture(t),sent=[];store.recordPayment(makePayment());
  const worker=createWorker({store,service:serviceFor(store),send:async row=>sent.push(row)});
  await worker.tick();assert.ok(sent.length>0);assert.ok(sent.every(r=>!r.content.includes('https://example.com/checkout')));
  assert.ok(sent.every(r=>r.content.includes('Estado atual')));
});
test('Pagamento tardio após cancelamento exige revisão',async t=>{
  const store=fixture(t),command=operationCommands.find(c=>c.data.name==='cancelar-pedido');
  await command.execute(interaction('staff',{motivo:'Comprador desistiu'}),{store,config,service:serviceFor(store,[])});
  assert.equal(store.get('ord_test').status,'cancelado');store.recordPayment(makePayment());
  assert.equal(store.get('ord_test').status,'revisao');
});
test('Falha da API impede autorização sem confiar no estado local pago',async t=>{
  const store=fixture(t);store.recordPayment(makePayment());
  const service=new Service(store,{searchPayments:async()=>{throw Error('API offline')}});
  await assert.rejects(()=>confirmar.execute(interaction('buyer'),{store,config,service}));
  assert.equal(store.get('ord_test').status,'pago');
});
test('Falhas persistentes de conciliação afetam a saúde do serviço',t=>{
  const store=fixture(t);for(let i=0;i<5;i++)store.schedule('ord_test',1000,true);
  assert.equal(store.health().failingJobs,1);store.schedule('ord_test');assert.equal(store.health().failingJobs,0);
});
test('Checkout diferencia URL de teste e produção e inclui vencimento',async()=>{
  let payload;
  const mp=new MercadoPago({...config,webhookUrl:'https://example.com/webhooks/mercadopago',successUrl:'https://example.com/success'},async(url,options)=>{
    payload=JSON.parse(options.body);return {ok:true,json:async()=>({id:'pref',init_point:'https://example.com/live',sandbox_init_point:'https://example.com/test'})};
  });
  const result=await mp.createPreference({id:'ord_test',description:'Camiseta',amount_cents:15000});
  assert.equal(result.url,'https://example.com/test');assert.equal(payload.items[0].unit_price,150);
  assert.equal(payload.expires,true);assert.equal(new URL(payload.notification_url).searchParams.get('source_news'),'webhooks');
});
test('Crash/reabertura mantém pagamento, reserva e comprovante',()=>{
  const dir=mkdtempSync(join(tmpdir(),'escrow-durable-')),path=join(dir,'test.sqlite');
  let store=new Store(path,config);
  try {
    store.create({id:'ord_test',guild_id:'guild',channel_id:'channel',buyer_id:'buyer',seller_id:'seller',description:'Camiseta',amount_cents:15000});
    store.checkout('ord_test',{id:'pref',url:'https://example.com/checkout'});store.recordPayment(makePayment());
    let o=store.get('ord_test');store.transition(o.id,o.version,['pago'],'repasse_pendente','buyer','recebido',{paid:true});
    const operation=store.reservePayout(o.id,store.get(o.id).version,'staff');store.close();
    store=new Store(path,config);
    assert.equal(store.paymentRows(o.id).length,1);assert.throws(()=>store.reservePayout(o.id,store.get(o.id).version,'other'));
    store.finishPayout(o.id,store.get(o.id).version,'staff',operation,'bank-ref-persist');store.close();
    store=new Store(path,config);assert.equal(store.get(o.id).status,'repassado');assert.equal(store.db.prepare('SELECT reference FROM payouts').get().reference,'bank-ref-persist');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
