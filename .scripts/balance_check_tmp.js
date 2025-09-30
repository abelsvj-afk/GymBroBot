const fs = require('fs');
const src = fs.readFileSync('c:/Users/Student/Desktop/GymBroBot/bot.js','utf8');
function find_unmatched(s){
  const stack=[]; let i=0; let line=1; let state=null;
  while(i<s.length){
    const ch=s[i]; const nxt=s[i+1];
    if(state){
      if(state==='//'){ if(ch==='\n'){ state=null; line++; } i++; continue; }
      if(state==='/*'){ if(ch==='*'&&nxt==='/' ){ state=null; i+=2; continue; } i++; continue; }
      if(state==='"' || state==="'" ){ if(ch==='\\') { i+=2; continue; } if(ch===state){ state=null; } if(ch==='\n') line++; i++; continue; }
      if(state==='`'){ if(ch==='\\') { i+=2; continue; } if(ch==='`'){ state=null; } if(ch==='\n') line++; i++; continue; }
    }
    if(ch==='/' && nxt==='/' ){ state='//'; i+=2; continue; }
    if(ch==='/' && nxt==='*' ){ state='/*'; i+=2; continue; }
    if(ch==='"' || ch==="'" || ch==='`'){ state=ch; i++; continue; }
    if(ch==='\n'){ line++; i++; continue; }
    if(ch==='('||ch==='['||ch==='{'){ stack.push({ch,line}); }
    else if(ch===')'||ch===']'||ch==='}'){ const last=stack.pop(); if(!last){ console.log('Unmatched closing', ch, 'at line', line); return; } const match={')':'(',']':'[','}':'{'}[ch]; if(last.ch!==match){ console.log('Mismatched closing', ch, 'at line', line, 'expected closing for', last.ch, 'opened at', last.line); return; } }
    i++;
  }
  if(stack.length){ console.log('Unclosed tokens at EOF:'); stack.forEach(x=>console.log(x.ch,'opened at line',x.line)); }
  else console.log('All balanced');
}
find_unmatched(src);
