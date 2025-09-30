#!/usr/bin/env node
import dotenv from 'dotenv';
import Storage from '../src/storage.js';
import OpenAI from 'openai';
dotenv.config();

async function main(){
  const MONGO_URI = process.env.MONGO_URI || null;
  const storage = new Storage(MONGO_URI, './data');
  const okConn = await storage.connect();
  console.log('Storage connected:', okConn ? 'yes' : 'no');
  const ping = await storage.ping();
  console.log('Storage ping:', ping);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try{
    const start = Date.now();
    const res = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo', messages:[{role:'user', content:'Respond with OK'}], max_tokens:3, temperature:0 });
    console.log('OpenAI OK, time:', Date.now()-start,'ms');
  }catch(e){ console.error('OpenAI check failed', e?.message||e); }

  // RW test
  try{
    await storage.save('__health_test_cli', { ts: Date.now() });
    const back = await storage.load('__health_test_cli', null);
    console.log('RW test ok:', !!back);
  }catch(e){ console.error('RW test failed', e); }
}

main().catch(e=>{ console.error('health-check error', e); process.exit(2); });
