import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { MercadoPago } from './mercadopago.js';
import { Service } from './service.js';
import { createWebhookServer } from './server.js';
import { createWorker } from './worker.js';
import { commands } from './commands/index.js';
import { UserError, requireThat } from './domain.js';

const config=loadConfig();
const store=new Store(config.databasePath,config);
store.claimRuntime();
const client=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const mp=new MercadoPago(config),service=new Service(store,mp);
const ctx={config,store,client,mp,service};
let stopping=false, ready=false;
const server=createWebhookServer({store,config,ready:()=>ready&&client.isReady()});
const worker=createWorker({store,service,send:async(row)=>{
  store.assertOwner();
  if(!client.isReady())throw new Error('Discord offline.');
  const channel=await client.channels.fetch(row.channel_id);
  if(!channel?.isTextBased() || !channel.send)throw new Error('Canal indisponível.');
  // Discord provides bounded nonce deduplication, not permanent exactly-once delivery.
  await channel.send({content:row.content,allowedMentions:{parse:[]},nonce:String(row.id),enforceNonce:true});
}});
const tick=setInterval(()=>{if(ready)void worker.tick().catch(()=>console.error('{"event":"worker_failed"}'));},3000);
const lease=setInterval(()=>{try{store.heartbeat();}catch{void shutdown(1);}},15000);
async function shutdown(code=0) {
  if(stopping)return;stopping=true;ready=false;
  clearInterval(tick);clearInterval(lease);worker.stop();
  const forced=setTimeout(()=>process.exit(1),15000);forced.unref();
  server.close();
  while(worker.running || service.locks.size)await new Promise(resolve=>setTimeout(resolve,100));
  client.destroy();store.close();process.exitCode=code;
}
client.on(Events.InteractionCreate,async i=>{
  if(!i.isChatInputCommand() || stopping)return;
  const command=commands.find(c=>c.data.name===i.commandName);
  if(!command)return;
  try {
    await i.deferReply({flags:64});
    requireThat(ready && i.inGuild() && i.guildId===config.guildId,'Bot indisponível ou servidor não autorizado.');
    await command.execute(i,ctx);
  }catch(err){
    console.error(JSON.stringify({event:'command_failed',command:i.commandName,errorType:err.name}));
    const content=err instanceof UserError?err.message:'Não foi possível concluir. Consulte /pedido-status antes de repetir; a operação pode ter sido registrada.';
    await (i.deferred||i.replied?i.editReply({content,allowedMentions:{parse:[]}}):i.reply({content,flags:64})).catch(()=>{});
  }
});
client.on(Events.Error,()=>console.error('{"event":"discord_error"}'));
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
try {
  await mp.verifyAccount();
  await new Promise((resolve,reject)=>{
    client.once(Events.ClientReady,resolve);
    client.login(config.token).catch(reject);
  });
  requireThat(client.user.id===config.clientId,'DISCORD_CLIENT_ID não corresponde ao bot conectado.');
  const guild=await client.guilds.fetch(config.guildId);
  const member=await guild.members.fetchMe();
  requireThat(member.permissions.has([16n,1024n,2048n,65536n]),'Bot precisa gerenciar canais, ver canais, enviar mensagens e ler histórico.');
  requireThat(config.staffRoleId!==config.guildId && await guild.roles.fetch(config.staffRoleId),'Cargo da staff inexistente ou é @everyone.');
  const staff=await guild.channels.fetch(config.staffChannelId);
  requireThat(staff?.isTextBased() && staff.permissionsFor(member)?.has([1024n,2048n]),'Bot não pode enviar no canal da staff.');
  // A crash during preference creation has an ambiguous result. Do not retry the POST.
  for(const o of store.db.prepare("SELECT id FROM orders WHERE status='criando_checkout'").all())store.checkoutFailed(o.id);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});
  ready=true;
  console.log(JSON.stringify({event:'ready',mode:config.liveMode?'production':'test'}));
  void worker.tick().catch(()=>console.error('{"event":"worker_failed"}'));
}catch(err){
  console.error(JSON.stringify({event:'startup_failed',message:err instanceof UserError?err.message:'Verifique configuração, credenciais, rede e permissões.'}));
  await shutdown(1);
}
