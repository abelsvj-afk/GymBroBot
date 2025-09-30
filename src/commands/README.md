Command modules for GymBroBot

Drop ES module files into this folder to add or override bot commands.

Module contract (default export):

export default {
  name: 'help', // command name (string)
  description: 'Short description',
  execute: async (context, message, args) => { /* ... */ }
}

The loader will call: await module.default.execute(context, message, args)

Context includes (at least):
- client: Discord client
- EmbedBuilder, PermissionFlagsBits, ChannelType (from discord.js)
- helpers like getOpenAIResponse, validateModel, adminLog
- data references and save helpers (e.g., habitTracker, saveHabits)

Example: see help.js
