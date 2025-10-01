/* post_channel_howtos.js

Builds short per-channel "how to use these commands" messages from the
files in data/command_posts and posts+pins them into the best-fit channels.

Environment variables behave like post_command_posts.js (DISCORD_TOKEN, GUILD_ID,
POST_MAP or CHANNEL_ID). The script attempts auto-matching when mapping isn't
provided.

Run: node scripts/post_channel_howtos.js
*/

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';

dotenv.config();
const token = process.env.DISCORD_TOKEN;
const postMapPath = process.env.POST_MAP;
const channelFallback = process.env.CHANNEL_ID;
const shouldPin = (process.env.PIN || '1') === '1';

if (!token) { console.error('DISCORD_TOKEN required'); process.exit(1); }

let postMap = null;
if (postMapPath) {
  try { postMap = JSON.parse(fs.readFileSync(postMapPath, 'utf8')); } catch(e){ console.error('Failed to read POST_MAP', e.message); }
}

const postsDir = path.join(process.cwd(), 'data', 'command_posts');
if (!fs.existsSync(postsDir)) { console.error('posts dir not found', postsDir); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

function parsePost(file) {
  const content = fs.readFileSync(file, 'utf8');
  const name = path.basename(file, '.md');
  const m = content.match(/Category:\s*\*\*(.+?)\*\*/i);
  const cat = m ? m[1].trim().toLowerCase() : 'general';
  const descMatch = content.split('\n').find(l=>l.trim().length>0);
  const firstLine = descMatch || '';
  const usageMatch = content.match(/Usage:[\s\S]*?```[\s\S]*?\n([\s\S]*?)\n```/i);
  const usage = usageMatch ? usageMatch[1].split('\n').map(s=>s.trim()).filter(Boolean)[0] : null;
  const exampleMatch = content.match(/Example:[\s\S]*?```\s*([\s\S]*?)\s*```/i);
  const example = exampleMatch ? exampleMatch[1].split('\n')[0].trim() : null;
  return { name, cat, firstLine, usage, example, content };
}

client.once('ready', async () => {
  console.log('Logged in as', client.user.tag);
  const files = fs.readdirSync(postsDir).filter(f=>f.endsWith('.md')).map(f=>path.join(postsDir,f));
  const posts = files.map(parsePost);
  const groups = posts.reduce((acc,p)=>{ (acc[p.cat]=acc[p.cat]||[]).push(p); return acc; }, {});

  // auto-discover candidates
  const guildId = process.env.GUILD_ID;
  let candidates = [];
  if (guildId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      candidates = guild.channels.cache.filter(c => (c.isTextBased || c.type === 0) && c.viewable).map(c=>({ id:c.id, name:c.name, topic:c.topic||'' }));
    } catch(e) { console.warn('guild channels fetch failed', e.message); }
  }

  for (const [group, items] of Object.entries(groups)) {
    // determine channel id for this group
    let channelId = postMap && postMap[group] ? postMap[group] : channelFallback;
    if (!channelId && candidates.length) {
      // score candidates by name/topic match
      const keywords = new Set([group]);
      items.forEach(it=>{ keywords.add(it.name); });
      let best=null, bestScore=0;
      for (const c of candidates) {
        const hay = (c.name + ' ' + (c.topic||'')).toLowerCase();
        let score=0; keywords.forEach(k=>{ if (!k) return; if (hay.includes(k)) score+=2; });
        if (hay.includes('bot')||hay.includes('commands')) score+=1;
        if (score>bestScore) { best=c; bestScore=score; }
      }
      if (best && bestScore>0) channelId = best.id;
    }

    if (!channelId) { console.log('No channel found for group', group, '- skipping how-to'); continue; }

    // build message
    let msg = `**How to use these ${group} commands**\n\n`;
    items.slice(0,20).forEach(it=>{
      msg += `**/${it.name}** — ${it.firstLine.replace(/\*/g,'').slice(0,120)}\n`;
      if (it.usage) msg += `Usage: ${it.usage}\n`;
      if (it.example) msg += `Example: ${it.example}\n`;
      msg += '\n';
    });
    msg += `Pin this message so members can find ${group} commands easily.`;

    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased) { console.warn('Channel not found or not text-based:', channelId); continue; }
      // avoid duplicate: check recent messages for similar start
      let recent=[]; try{ recent = await ch.messages.fetch({limit:50}); }catch(e){}
      const snippet = msg.slice(0,140);
      const dup = recent.find(m=>m.author && m.author.id===client.user.id && m.content && m.content.slice(0,140)===snippet);
      if (dup) { console.log('How-to already posted for', group, 'in', ch.name); continue; }
      const sent = await ch.send({ content: msg });
      if (shouldPin && sent.pin) { try{ await sent.pin(); console.log('Pinned how-to in', ch.name); }catch(e){ console.warn('pin failed', e.message); } }
      console.log('Posted how-to for', group, '->', channelId);
      await new Promise(r=>setTimeout(r,600));
    } catch (e) { console.error('Failed to post how-to for', group, e.message); }
  }

  client.destroy(); process.exit(0);
});

client.login(token).catch(e=>{ console.error('Login failed', e.message); process.exit(1); });
