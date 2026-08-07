import "dotenv/config";
import { REST, Routes } from "discord.js";
import * as vender from "./commands/vender.js";
import * as confirmar from "./commands/confirmar.js";
import * as disputa from "./commands/disputa.js";
import * as liberar from "./commands/liberar.js";

const commands = [vender, confirmar, disputa, liberar].map((c) => c.data.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registrando comandos slash...");
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log("Comandos registrados com sucesso.");
} catch (err) {
  console.error(err);
}
