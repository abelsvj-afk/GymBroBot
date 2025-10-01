/* post_command_posts.js

Usage:
  # Simple: post every command file into one channel
  DISCORD_TOKEN=... CHANNEL_ID=123456 node scripts/post_command_posts.js

  # Use a group->channel mapping JSON (e.g. { "habits": "123", "fitness": "456" })
  DISCORD_TOKEN=... POST_MAP=./post_map.json node scripts/post_command_posts.js

Environment:
  DISCORD_TOKEN - required
  CHANNEL_ID - optional (fallback when POST_MAP not provided)
  POST_MAP - optional path to JSON mapping group -> channelId
  PIN - optional '1' or '0' to pin posted messages (default: 1)

This script uses discord.js to post each file in data/command_posts as a message
and optionally pins the message. Run it locally when you're ready to publish.
*/

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';

// Load .env if present so the script can be run without manually exporting env vars
dotenv.config();

const token = process.env.DISCORD_TOKEN;
const channelFallback = process.env.CHANNEL_ID;
const postMapPath = process.env.POST_MAP;
const shouldPin = (process.env.PIN || '1') === '1';

if (!token) {
  console.error('DISCORD_TOKEN required in environment. Aborting.');
  process.exit(1);
}

let postMap = null;
if (postMapPath) {
  try {
    postMap = JSON.parse(fs.readFileSync(postMapPath, 'utf8'));
  } catch (e) {
    console.error('Failed to read POST_MAP file', postMapPath, e.message);
    process.exit(1);
  }
}

const postsDir = path.join(process.cwd(), 'data', 'command_posts');
if (!fs.existsSync(postsDir)) { console.error('Posts dir not found:', postsDir); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
  console.log('Logged in as', client.user.tag);
  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));

  // If user didn't provide a mapping or single channel, attempt auto-discovery
  // by looking up common channel names inside the configured GUILD_ID.
  const guildId = process.env.GUILD_ID;
  let discoveredMap = {};
  if (!postMap && !channelFallback && guildId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      const textChannels = guild.channels.cache.filter(c => (c.isTextBased || c.type === 0 || c.type === 'GUILD_TEXT' || c.type === 'GUILD_TEXT') && c.viewable);

      // Build a list of candidate channels with searchable text (name + topic)
      const candidates = textChannels.map(c => ({ id: c.id, name: (c.name || '').toLowerCase(), topic: (c.topic || '').toLowerCase() }));

      // We'll compute a best-fit channel for each command post later; store candidates on discoveredMap for now
      discoveredMap._candidates = candidates;
      postMap = postMap || {};
      console.log('Discovered', candidates.length, 'visible text channels for auto-matching.');
    } catch (e) {
      console.warn('Auto-discovery failed:', e.message);
    }
  }

  // candidates list for auto-matching
  const candidates = (discoveredMap && discoveredMap._candidates) ? discoveredMap._candidates : (guildId ? [] : []);

  for (const file of files) {
    const full = path.join(postsDir, file);
    const content = fs.readFileSync(full, 'utf8');

    // parse group
    let group = null;
    const m = content.match(/Category:\s*\*\*(.+?)\*\*/i);
    if (m) group = m[1].trim().toLowerCase();

    // resolve channel id
    let channelId = null;
    if (postMap && group && postMap[group]) channelId = postMap[group];
    if (!channelId) channelId = channelFallback;

    // attempt auto-match using candidates
    if (!channelId && candidates.length) {
      const keywords = new Set();
      if (group) keywords.add(group);
      const fname = path.basename(file, '.md').toLowerCase(); keywords.add(fname);
      const usageMatch = content.match(/Usage:\s*```[\s\S]*?\n([\s\S]*?)\n```/i);
      if (usageMatch) usageMatch[1].split(/\s|\W/).filter(Boolean).slice(0,8).forEach(w=>keywords.add(w.toLowerCase()));

      let best=null, bestScore=0;
      for (const c of candidates) {
        const hay = (c.name + ' ' + (c.topic||'')).toLowerCase();
        let score = 0;
        for (const k of keywords) { if (!k) continue; if (hay.includes(k)) score += 2; }
        if (hay.includes('bot') || hay.includes('commands')) score += 1;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best && bestScore > 0) { channelId = best.id; console.log('Auto-matched', file, '->', best.name, '(score', bestScore, ')'); }
      if (!channelId && guildId) { try { const g = await client.guilds.fetch(guildId); if (g && g.systemChannelId) channelId = g.systemChannelId; } catch(e){} }
    }

    if (!channelId) { console.warn('No channel configured for', file, '(group:', group, ') — skipping'); continue; }

    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased || !ch.send) { console.warn('Channel not found or not text-based:', channelId); continue; }

      // Avoid duplicate posts: check recent messages and pinned messages for similar content
      let recent = [];
      try { recent = await ch.messages.fetch({ limit: 50 }); } catch(e) {}
      const startSnippet = content.slice(0, 120).trim();
  const alreadyPosted = recent.find(m => m.author && m.author.id === client.user.id && ((m.content && m.content.slice(0,120).trim() === startSnippet) || (m.embeds && m.embeds.length && m.embeds[0].title && content.includes(m.embeds[0].title))));
  if (alreadyPosted) { console.log('Skipping', file, '— already posted in', channelId, 'messageId=', alreadyPosted.id); continue; }

      // Helper: split content into chunks no longer than maxLen, trying to split at double-newlines or newlines
      function chunkContent(text, maxLen = 1900) {
        if (!text) return [''];
        if (text.length <= maxLen) return [text];
        const chunks = [];
        let remaining = text;
        while (remaining.length) {
          if (remaining.length <= maxLen) { chunks.push(remaining); break; }
          // try to find a good split point: double newline before maxLen
          let idx = remaining.lastIndexOf('\n\n', Math.min(maxLen, remaining.length - 1));
          if (idx === -1) idx = remaining.lastIndexOf('\n', Math.min(maxLen, remaining.length - 1));
          if (idx === -1 || idx < Math.floor(maxLen * 0.5)) idx = maxLen; // fallback to hard split
          const part = remaining.slice(0, idx).trim();
          chunks.push(part);
          remaining = remaining.slice(idx).trim();
        }
        return chunks;
      }

      const chunks = chunkContent(content, 1900);
      let sent = null;
      try {
        sent = await ch.send({ content: chunks[0] });
        console.log('Posted', file, '->', channelId, 'messageId=', sent.id, '(part 1 of', chunks.length + ')');
        if (shouldPin && sent.pin) { try { await sent.pin(); console.log('Pinned', sent.id); } catch (e) { console.warn('Pin failed:', e.message); } }
        // post remaining parts with a header indicating continuation
        for (let i = 1; i < chunks.length; i++) {
          const header = `_(Continued: part ${i+1}/${chunks.length})_\n`;
          const partSent = await ch.send({ content: header + '\n' + chunks[i] });
          console.log('Posted part', i+1, 'messageId=', partSent.id);
          await new Promise(r=>setTimeout(r, 500));
        }
      } catch (e) {
        console.error('Failed to post', file, e.message);
      }
      await new Promise(r=>setTimeout(r, 800));
    } catch (e) {
      console.error('Failed to post', file, e.message);
    }
  }

  console.log('Done posting. Logging out.');
  client.destroy();
  process.exit(0);
});

client.login(token).catch(e=>{ console.error('Login failed', e.message); process.exit(1); });
