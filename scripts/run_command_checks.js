// run_command_checks.js
// Runs the command check helper included in health.js and writes a JSON report.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const healthMod = await import(pathToFileURL(path.join(process.cwd(), 'src', 'commands', 'health.js')).href);
  // Build a lightweight context similar to tests/run_all_commands
  const ctx = {
    client: { user: { id: 'BOT' }, guilds: { cache: new Map() }, users: { fetch: async id => ({ id, username: 'MockUser' }) } },
    // Minimal EmbedBuilder mock used by many commands during simulated checks
    EmbedBuilder: class MockEmbed {
      constructor(){ this._fields = []; }
      setTitle(t){ this.title = t; return this; }
      setDescription(d){ this.description = d; return this; }
      addFields(...f){ this._fields.push(...f.flat()); return this; }
      setColor(c){ this.color = c; return this; }
      setTimestamp(){ this.timestamp = new Date(); return this; }
      setFooter(f){ this.footer = f; return this; }
      setAuthor(a){ this.author = a; return this; }
    },
    storage: { load: async(k,d)=>d, save: async()=>{}, ping: async()=>({ok:true}), mongoDb: null },
    validateModel: async ()=>({ ok: true, duration: 10 }),
    aiHealth: [],
    habitTracker: {},
    fitnessWeekly: {},
    partnerQueue: [],
  messageCounts: {},
  achievementsStore: {},
    // helper stubs used by commands
    saveHabits: async ()=>{},
    saveWeekly: async ()=>{},
    savePartnerQueue: async ()=>{},
    awardAchievement: async ()=>false
  };
  const res = await healthMod.runCommandChecks(ctx, null, { simulated: true, timeoutMs: 8000 });
  fs.writeFileSync(path.join(process.cwd(),'command_check_report.json'), JSON.stringify(res, null, 2));
  console.log('Wrote command_check_report.json');
}

main().catch(e=>{ console.error(e); process.exit(1); });
