import "dotenv/config";
import { Client, GatewayIntentBits, Collection } from "discord.js";
import * as vender from "./commands/vender.js";
import * as confirmar from "./commands/confirmar.js";
import * as disputa from "./commands/disputa.js";
import * as liberar from "./commands/liberar.js";
import { attachDiscordClient } from "./server.js"; // também sobe o servidor Express (ver server.js)

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.commands = new Collection();
for (const cmd of [vender, confirmar, disputa, liberar]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once("ready", () => {
  console.log(`Bot online como ${client.user.tag}`);
  attachDiscordClient(client); // permite ao webhook postar mensagens nos canais
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Erro ao executar /${interaction.commandName}:`, err);
    const payload = { content: "Deu erro ao executar esse comando.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
