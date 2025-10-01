import helpers from '../helpers.js';
const _ex = helpers.exposed || {};
const adminLog = _ex.adminLog || globalThis.adminLog || (async () => {});
const savePartners = _ex.savePartners || globalThis.savePartners || (async () => {});

export default {
  name: 'unpair',
  description: 'Admin: unpair a partner channel or users',
  group: 'partners',
  notes: 'Usage: !unpair <channelId|userIdA|userIdB>',
  execute: async (context, message, args) => {
    const partners = context.partners || {};

    const isAdmin = (msg) => {
      try {
        if (!msg.guild) return true;
        const perms = msg.member?.permissions;
        if (perms && typeof perms.has === 'function') {
          if (perms.has('Administrator') || perms.has('ManageGuild')) return true;
        }
        const roles = msg.member?.roles?.cache;
        if (roles && typeof roles.size === 'number' && roles.size > 0) {
          for (const r of roles.values()) {
            if (r?.name && /admin|moderator|mod|owner/i.test(r.name)) return true;
          }
          return false;
        }
        return true;
      } catch (e) { return false; }
    };

    if (!isAdmin(message)) return message.reply('You do not have permission to run this command.');
    const key = args[0];
    if (!key) return message.reply('Usage: !unpair <channelId|userId>');

    // Try channel id first
    if (partners[key]) {
      // Try to delete a real channel if present
      try {
        if (message.guild && message.guild.channels && message.guild.channels.cache && message.guild.channels.cache.get) {
          const ch = message.guild.channels.cache.get(key);
          if (ch && typeof ch.delete === 'function') {
            try { await ch.delete('Unpaired by admin'); } catch(e) {}
          }
        }
      } catch(e) {}
      delete partners[key];
      try { await savePartners(); } catch (e) {}
      try { await adminLog(message.guild, `Admin ${message.author.id} unpaired channel ${key}`); } catch (e) {}
      return message.reply(`Unpaired and removed partnership record for ${key}`);
    }

    // Otherwise try treat key as a user id: find any partner entry containing them
    const found = Object.keys(partners).find(k => (partners[k].users||[]).includes(key));
    if (!found) return message.reply('No partner record found for that id.');

    delete partners[found];
    try { await savePartners(); } catch (e) {}
    try { await adminLog(message.guild, `Admin ${message.author.id} unpaired ${key} (record ${found})`); } catch (e) {}
    return message.reply(`Unpaired user ${key} (record ${found})`);
  }
};
