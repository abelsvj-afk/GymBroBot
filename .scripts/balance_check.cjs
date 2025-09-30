const fs = require('fs');
const path = require('path');
const file = path.resolve(process.cwd(), 'bot.js');
const src = fs.readFileSync(file, 'utf8');
let stack = [];
let line = 1;
let i = 0;
let state = { single: false, double: false, back: false, linec: false, block: false };
function push(ch) { stack.push({ ch, line, i }); }
for (i = 0; i < src.length; i++) {
  const ch = src[i];
  const next = src[i + 1];
  if (ch === '\n') { line++; state.linec = false; if (state.single) state.single = false; continue; }

  if (state.linec) continue;
  if (state.block) {
    if (ch === '*' && next === '/') { state.block = false; i++; }
    continue;
  }
  if (!state.single && !state.double && !state.back) {
    if (ch === '/' && next === '/') { state.linec = true; i++; continue; }
    if (ch === '/' && next === '*') { state.block = true; i++; continue; }
  }
  if (state.single) {
    if (ch === '\\' && next) { i++; continue; }
    if (ch === "'") state.single = false;
    continue;
  }
  if (state.double) {
    if (ch === '\\' && next) { i++; continue; }
    if (ch === '"') state.double = false;
    continue;
  }
  if (state.back) {
    if (ch === '`') state.back = false;
    if (ch === '\\' && next) { i++; continue; }
    continue;
  }
  if (ch === "'") { state.single = true; continue; }
  if (ch === '"') { state.double = true; continue; }
  if (ch === '`') { state.back = true; continue; }

  if (ch === '{' || ch === '(' || ch === '[') push(ch);
  else if (ch === '}' || ch === ')' || ch === ']') {
    const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
    const top = stack.pop();
    if (!top) { console.log('Unmatched closing', ch, 'at line', line); process.exit(0); }
    if (top.ch !== expected) { console.log('Mismatched', ch, 'closed at line', line, 'expected', (expected === '{' ? '}' : expected === '(' ? ')' : ']'), 'but top is', top.ch, 'opened at line', top.line); process.exit(0); }
  }
}
if (stack.length) {
  console.log('Unclosed tokens at EOF:');
  stack.forEach(s => console.log(s.ch, 'opened at line', s.line));
} else console.log('All balanced (ignoring strings/comments)');
