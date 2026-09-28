import { commands } from './commands/index.js';
const {DISCORD_TOKEN:token,DISCORD_CLIENT_ID:clientId,DISCORD_GUILD_ID:guildId}=process.env;
if(!token || !/^\d{5,22}$/.test(clientId || '') || !/^\d{5,22}$/.test(guildId || ''))throw new Error('Configure DISCORD_TOKEN, DISCORD_CLIENT_ID e DISCORD_GUILD_ID.');
const result=await fetch(`https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`,{
  method:'PUT',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify(commands.map(c=>c.data)),signal:AbortSignal.timeout(15000),
});
if(!result.ok)throw new Error(`Registro dos comandos falhou: HTTP ${result.status}`);
console.log(`${commands.length} comandos registrados.`);
