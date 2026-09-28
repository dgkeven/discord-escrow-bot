import { Client, GatewayIntentBits, SlashCommandBuilder } from 'discord.js';
import { commands } from '../src/commands/index.js';
// Loads the actual installed SDK without logging in or contacting Discord.
const client=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const names=new Set();
for(const {data} of commands) {
  if(names.has(data.name))throw new Error('Comando duplicado.');names.add(data.name);
  const builder=new SlashCommandBuilder().setName(data.name).setDescription(data.description);
  for(const option of data.options) {
    const fill=b=>{
      b.setName(option.name).setDescription(option.description).setRequired(option.required);
      if(option.choices)b.addChoices(...option.choices);
      if(option.min_length!==undefined)b.setMinLength(option.min_length);
      if(option.max_length!==undefined)b.setMaxLength(option.max_length);
      if(option.min_value!==undefined)b.setMinValue(option.min_value);
      if(option.max_value!==undefined)b.setMaxValue(option.max_value);
      return b;
    };
    if(option.type===3)builder.addStringOption(fill);
    else if(option.type===6)builder.addUserOption(fill);
    else if(option.type===10)builder.addNumberOption(fill);
    else throw new Error('Tipo de opção não verificado.');
  }
  builder.toJSON();
}
client.destroy();console.log(`${names.size} comandos validados com discord.js instalado.`);
