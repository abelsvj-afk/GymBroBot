#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const commandsDir = path.join(process.cwd(), 'src', 'commands');
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
for (const f of files) {
  const full = path.join(commandsDir, f);
  try {
    const mod = await import(pathToFileURL(full).href);
    const def = mod.default || {};
    console.log(f.padEnd(30), 'name=', def.name || '-', 'description=', def.description ? 'OK' : 'MISSING', 'example=', def.example ? 'OK' : (def.exampleArgs ? 'args' : 'MISSING'), 'notes=', def.notes ? 'OK' : 'MISSING', 'permissions=', def.permissions || (def.adminOnly ? 'adminOnly' : 'Everyone'));
  } catch (e) {
    console.error('IMPORT FAIL', f, e.message);
  }
}
