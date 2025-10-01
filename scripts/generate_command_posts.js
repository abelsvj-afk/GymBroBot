// generate_command_posts.js
// Scans src/commands, imports modules, and writes per-command Discord-ready posts
// and a consolidated COMMANDS.md in the repository root.
// Run: node scripts/generate_command_posts.js

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const commandsDir = path.join(process.cwd(), 'src', 'commands');
const outDir = path.join(process.cwd(), 'data', 'command_posts');
if (!fs.existsSync(commandsDir)) throw new Error('commands dir not found: ' + commandsDir);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

function slashUsageFor(def) {
  if (!def || !def.slash) return null;
  const s = def.slash;
  // type: 'subcommand' or omitted; group may be present
  if (s.group) {
    // group + subcommand name
    // if s.type==='subcommand' then usage: /<group> <name> [options]
    const opts = (s.options || []).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return `/${s.group} ${def.name}${opts ? ' ' + opts : ''}`;
  }
  if (s.type === 'subcommand') {
    const opts = (s.options || []).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return `/${def.name}${opts ? ' ' + opts : ''}`;
  }
  // fallback: assume top-level slash
  const opts = (s.options || []).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
  return `/${def.name}${opts ? ' ' + opts : ''}`;
}

async function build() {
  const indexLines = ['# Command Reference (Discord posts)\n', 'Each file in data/command_posts is ready to post in a Discord channel. Use these to pin instructions for your server.\n'];

  for (const f of files) {
    const full = path.join(commandsDir, f);
    let mod;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (e) {
      console.error('import failed for', f, e.message);
      continue;
    }
    const def = mod.default || {};
    const name = def.name || path.basename(f, '.js');
    const description = def.description || def.summary || def.help || 'No description available.';
    const group = (def.group || (def.slash && def.slash.group) || 'general');
  const usageSlash = slashUsageFor(def) || `/${name}`;
  // If exampleArgs provided, use it; otherwise synthesize from slash options or leave empty
  let usagePrefix;
  if (def.exampleArgs) usagePrefix = `!${name} ${def.exampleArgs}`.trim();
  else if (def.slash && Array.isArray(def.slash.options) && def.slash.options.length) {
    const args = def.slash.options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    usagePrefix = `!${name} ${args}`.trim();
  } else {
    usagePrefix = `!${name}`;
  }

  // Build a sensible example: prefer explicit example, otherwise synthesize from options
  let example;
  if (def.example) example = def.example;
  else if (def.slash && Array.isArray(def.slash.options) && def.slash.options.length) {
    // replace required/optional placeholders with sample values
    const sample = usageSlash.replace(/<([^>]+)>|\[([^\]]+)\]/g, (m, r, o) => {
      const key = r || o;
      // pick a tiny realistic sample depending on name
      if (/user|member|mention/i.test(key)) return '@exampleUser';
      if (/days?|count|num|amount|qty|reps?/i.test(key)) return '3';
      if (/date|time|when|at/i.test(key)) return 'tomorrow';
      if (/name|what|text|note|reason|title/i.test(key)) return 'example';
      return 'example';
    });
    example = sample;
  } else {
    example = `${usagePrefix}`;
  }

  const perms = def.permissions ? def.permissions : (def.adminOnly ? 'Admin only' : 'Everyone');

    const postLines = [];
    postLines.push(`**${name}** — ${description}`);
    postLines.push('');
    postLines.push(`Category: **${group}**`);
    postLines.push('');
    postLines.push('Usage:');
    postLines.push('```');
    postLines.push(`Slash: ${usageSlash}`);
    postLines.push(`Prefix: ${usagePrefix}`);
    postLines.push('```');
    postLines.push('');
    postLines.push('Quick examples:');
    // Example heuristics: if slash has options, create a sample
    if (def.slash && Array.isArray(def.slash.options) && def.slash.options.length) {
      const sampleOpts = def.slash.options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
      if (def.slash.group) postLines.push(`• ${usageSlash} — e.g. ${usageSlash.replace(/<[^>]+>/g, 'example').replace(/\[([^\]]+)\]/g,'example')}`);
      else postLines.push(`• ${usageSlash} — e.g. ${usageSlash.replace(/<[^>]+>/g, 'example').replace(/\[([^\]]+)\]/g,'example')}`);
    } else {
      postLines.push(`• ${usageSlash} — e.g. ${usageSlash}`);
    }
    postLines.push('');
    postLines.push('Notes:');
  postLines.push(def.notes || 'Post this in the relevant channel and pin it so users have quick access to usage.');
  postLines.push('');
  postLines.push('Example:');
  postLines.push('```');
  postLines.push(example);
  postLines.push('```');
  postLines.push('');
  postLines.push(`Permissions: ${perms}`);

    const out = postLines.join('\n');
    const outFile = path.join(outDir, `${name}.md`);
    fs.writeFileSync(outFile, out, 'utf8');

    indexLines.push(`- [${name}](data/command_posts/${name}.md) — ${description}`);
  }

  fs.writeFileSync(path.join(process.cwd(), 'COMMANDS.md'), indexLines.join('\n'), 'utf8');
  console.log('Wrote posts for', files.length, 'commands to', outDir);
}

build().catch(e=>{ console.error(e); process.exit(1); });
