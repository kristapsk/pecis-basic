/* Pecis BASIC - browser-side interpreter. No eval(), no network dependency. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PecisBasic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class BasicError extends Error {
    constructor(message, line) { super(message); this.name = 'BasicError'; this.line = line ?? null; }
  }
  const upper = x => String(x).toUpperCase();
  const waitTick = () => new Promise(resolve => setTimeout(resolve, 0));
  function splitOutside(text, delimiter) {
    const result = []; let start = 0, quote = false, depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quote && text[i+1] === '"') { i++; continue; } quote = !quote; }
      if (quote) continue;
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && c === delimiter) { result.push(text.slice(start, i)); start = i + 1; }
    }
    result.push(text.slice(start)); return result;
  }
  function positionOfWord(text, keyword, start = 0) {
    let quote = false, depth = 0;
    const w = upper(keyword), s = upper(text);
    for (let i = start; i <= s.length - w.length; i++) {
      const c = text[i];
      if (c === '"') { if (quote && text[i+1] === '"') { i++; continue; } quote = !quote; continue; }
      if (quote) continue;
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && s.slice(i, i+w.length) === w &&
         (i === 0 || !/[\w$]/.test(s[i-1])) &&
         (i+w.length === s.length || !/[\w$]/.test(s[i+w.length]))) return i;
    }
    return -1;
  }
  function splitStatements(source) {
    // IF owns everything after THEN, including colon-separated branch statements.
    const tokens = splitOutside(source, ':'); const results = [];
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i].trim();
      if (/^(?:IF\s|REM(?:\s|$)|')/i.test(item)) {
        results.push(tokens.slice(i).join(':').trim()); break;
      }
      if (item) results.push(item);
    }
    return results;
  }
  function tokenize(text) {
    const out = []; let i = 0;
    while (i < text.length) {
      const rest = text.slice(i), ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let s = ''; i++;
        let closed = false;
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i+1] === '"') { s += '"'; i += 2; continue; }
            closed = true; i++; break;
          }
          s += text[i++];
        }
        if (!closed) throw new BasicError('NEPABEIGTA TEKSTA VIRKNE');
        out.push({ type: 'string', value: s }); continue;
      }
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/);
      if (number) { out.push({ type: 'number', value: Number(number[0]) }); i += number[0].length; continue; }
      const id = rest.match(/^[A-Za-z_][A-Za-z0-9_]*[$%]?/);
      if (id) { out.push({ type: 'id', value: upper(id[0]) }); i += id[0].length; continue; }
      const op = rest.match(/^(<=|>=|<>|!=|==|[+\-*/^=<>(),;])/);
      if (op) { out.push({ type: 'op', value: op[0] }); i += op[0].length; continue; }
      throw new BasicError('NEATPAZĪTA ZĪME: ' + ch);
    }
    out.push({ type: 'eof', value: '' }); return out;
  }
  const priorities = { OR:1, AND:2, '=':3, '==':3, '<>':3, '!=':3, '<':3, '>':3, '<=':3, '>=':3, '+':4, '-':4, '*':5, '/':5, '^':7 };
  class ExpressionParser {
    constructor(runtime, text) { this.runtime = runtime; this.items = tokenize(text); this.at = 0; }
    peek() { return this.items[this.at]; }
    next() { return this.items[this.at++]; }
    eat(sym) { if (this.peek().value === sym) { this.at++; return true; } return false; }
    expect(sym) { if (!this.eat(sym)) throw new BasicError('GAIDĪTS ' + sym); }
    parse() { const value = this.expr(0); if (this.peek().type !== 'eof') throw new BasicError('IZTEIKSMES SINTAKSES KĻŪDA'); return value; }
    expr(min) {
      let tok = this.next(), left;
      if (tok.type === 'number' || tok.type === 'string') left = tok.value;
      else if (tok.value === '(') { left = this.expr(0); this.expect(')'); }
      else if (tok.value === '+' || tok.value === '-') {
        left = this.expr(6); left = tok.value === '-' ? -this.runtime.number(left) : this.runtime.number(left);
      } else if (tok.value === 'NOT') left = this.runtime.truth(this.expr(3)) ? 0 : -1;
      else if (tok.type === 'id') {
        if (this.eat('(')) {
          const args = [];
          if (!this.eat(')')) { do { args.push(this.expr(0)); } while (this.eat(',')); this.expect(')'); }
          left = this.runtime.resolveCall(tok.value, args);
        } else left = this.runtime.getVar(tok.value);
      } else throw new BasicError('IZTEIKSMES SINTAKSES KĻŪDA');
      while (true) {
        const op = this.peek().value, prec = priorities[op];
        if (prec === undefined || prec < min) break;
        this.next(); const right = this.expr(prec + (op === '^' ? 0 : 1));
        left = this.runtime.binary(op, left, right);
      }
      return left;
    }
  }
  function formatNum(n) {
    if (!Number.isFinite(n)) throw new BasicError('SKAITĻOŠANAS KĻŪDA');
    if (Object.is(n, -0)) n = 0;
    return String(Number(n.toPrecision(11)));
  }
  function unquote(str) { const s = str.trim(); return s.startsWith('"') && s.endsWith('"') ? s.slice(1,-1).replace(/""/g,'"') : s; }

  class Interpreter {
    constructor(hooks = {}) {
      this.hooks = { print: hooks.print || (()=>{}), input: hooks.input || (async ()=>''), clear: hooks.clear || (()=>{}), storage: hooks.storage || null, status: hooks.status || (()=>{}) };
      this.lines = new Map(); this.resetState(); this.running = false; this.cancel = false;
      this.lastSaved = 'PROGRAMMA'; this.stepLimit = 1000000;
    }
    resetState() { this.vars = new Map(); this.arrays = new Map(); this.loops = []; this.returns = []; this.dataAt = 0; this.outputBuffer = ''; this.randomSeed = 0; }
    number(x) { const n = Number(x); if (!Number.isFinite(n)) throw new BasicError('GAIDĪTS SKAITLIS'); return n; }
    truth(x) { return typeof x === 'string' ? x.length > 0 : this.number(x) !== 0; }
    getVar(name) { return this.vars.has(name) ? this.vars.get(name) : name.endsWith('$') ? '' : 0; }
    setVar(name, value) {
      if (name.endsWith('$')) this.vars.set(name, String(value));
      else { const num = this.number(value); this.vars.set(name, name.endsWith('%') ? Math.trunc(num) : num); }
    }
    keyFor(indices) { return indices.map(n=>{ if (n < 0 || !Number.isInteger(n)) throw new BasicError('NEPAREIZS MASĪVA INDEKSS'); return n; }).join(','); }
    array(name, indices) {
      let entry = this.arrays.get(name);
      if (!entry) { entry = { dims: indices.map(()=>10), values: new Map() }; this.arrays.set(name, entry); }
      if (indices.length !== entry.dims.length || indices.some((n,i)=>n>entry.dims[i])) throw new BasicError('MASĪVA INDEKSS ĀRPUS ROBEŽĀM');
      return entry;
    }
    getArray(name, indices) { const a=this.array(name,indices.map(x=>Math.trunc(this.number(x)))); const key=this.keyFor(indices.map(x=>Math.trunc(this.number(x)))); return a.values.has(key) ? a.values.get(key) : name.endsWith('$')?'':0; }
    setArray(name, indices, val) { indices=indices.map(x=>Math.trunc(this.number(x))); const a=this.array(name,indices), key=this.keyFor(indices); a.values.set(key, name.endsWith('$') ? String(val) : this.number(val)); }
    binary(op,a,b) {
      if (op === 'AND') return this.truth(a) && this.truth(b) ? -1 : 0;
      if (op === 'OR') return this.truth(a) || this.truth(b) ? -1 : 0;
      if (['=','==','<>','!=','<','>','<=','>='].includes(op)) {
        if (typeof a !== typeof b) throw new BasicError('NESADERĪGI DATU TIPI');
        const ok = ({ '=':()=>a===b, '==':()=>a===b, '<>':()=>a!==b, '!=':()=>a!==b, '<':()=>a<b, '>':()=>a>b, '<=':()=>a<=b, '>=':()=>a>=b })[op]();
        return ok ? -1 : 0;
      }
      if (op === '+' && typeof a==='string' && typeof b==='string') return a+b;
      const x=this.number(a), y=this.number(b);
      if (op==='/' && y===0) throw new BasicError('DALĪŠANA AR NULLI');
      const fn={'+':()=>x+y,'-':()=>x-y,'*':()=>x*y,'/':()=>x/y,'^':()=>Math.pow(x,y)}[op];
      if (!fn) throw new BasicError('NEZINĀMS OPERATORS');
      const value=fn(); if (!Number.isFinite(value)) throw new BasicError('SKAITĻOŠANAS KĻŪDA'); return value;
    }
    resolveCall(name,args) {
      const n=i=>this.number(args[i]), s=i=>String(args[i]);
      const funcs={
        'ABS':()=>Math.abs(n(0)), 'INT':()=>Math.floor(n(0)), 'FIX':()=>Math.trunc(n(0)),
        'SGN':()=>Math.sign(n(0)), 'SQR':()=>Math.sqrt(n(0)), 'SIN':()=>Math.sin(n(0)),
        'COS':()=>Math.cos(n(0)), 'TAN':()=>Math.tan(n(0)), 'ATN':()=>Math.atan(n(0)),
        'LOG':()=>Math.log(n(0)), 'EXP':()=>Math.exp(n(0)),
        'RND':()=>Math.random(), 'LEN':()=>s(0).length,
        'ASC':()=>s(0).length?s(0).charCodeAt(0):0,
        'CHR$':()=>String.fromCharCode(n(0)), 'STR$':()=>formatNum(n(0)),
        'VAL':()=>{ const m=s(0).match(/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/); return m?Number(m[0]):0; },
        'LEFT$':()=>s(0).slice(0,Math.max(0,Math.trunc(n(1)))),
        'RIGHT$':()=>s(0).slice(-Math.max(0,Math.trunc(n(1)))) || '',
        'MID$':()=>s(0).slice(Math.max(0,Math.trunc(n(1))-1), args.length===3?Math.max(0,Math.trunc(n(1))-1)+Math.max(0,Math.trunc(n(2))):undefined),
        'TAB':()=>({ spacing:'TAB', value:n(0) }), 'SPC':()=>({ spacing:'SPC', value:n(0) })
      };
      if (Object.prototype.hasOwnProperty.call(funcs,name)) {
        const result=funcs[name](); if (typeof result === 'number' && !Number.isFinite(result)) throw new BasicError('NEATĻAUTA FUNKCIJAS ARGUMENTA VĒRTĪBA'); return result;
      }
      return this.getArray(name,args);
    }
    evaluate(expr) { return new ExpressionParser(this, expr).parse(); }
    list(from=null,to=null) { return [...this.lines.entries()].sort((a,b)=>a[0]-b[0]).filter(([n])=>(from===null||n>=from)&&(to===null||n<=to)).map(([n,v])=>n+' '+v).join('\n'); }
    import(text) { const fresh=new Map(); for (const line of String(text).split(/\r?\n/)) { if (!line.trim()) continue; const m=line.match(/^\s*(\d+)\s*(.*)$/); if (!m) throw new BasicError('NEPAREIZA PROGRAMMAS RINDA: '+line.slice(0,30)); const n=Number(m[1]); if (n<=0||n>65535) throw new BasicError('NEPAREIZS RINDAS NUMURS'); if (m[2].trim()) fresh.set(n,m[2].trim()); } this.lines=fresh; }
    print(msg) { this.hooks.print(String(msg)); }
    flushOutput() { if (this.outputBuffer) { this.print(this.outputBuffer+'\n'); this.outputBuffer=''; } }
    outputPart(value) {
      if (value && typeof value==='object' && value.spacing) {
        const pos=this.outputBuffer.length; const count=value.spacing==='SPC'?Math.max(0,Math.trunc(value.value)):Math.max(0,Math.trunc(value.value)-1-pos);
        this.outputBuffer+=' '.repeat(Math.min(200,count)); return;
      }
      this.outputBuffer += typeof value === 'number' ? formatNum(value) : String(value);
    }
    printStatement(args) {
      if (!args.trim()) { this.print(this.outputBuffer+'\n'); this.outputBuffer=''; return; }
      // Split comma/semicolon at top level without losing separator.
      const parts=[]; let start=0, depth=0, quote=false;
      for(let i=0;i<args.length;i++) {
        const c=args[i]; if(c==='"'){if(quote&&args[i+1]==='"'){i++;continue;}quote=!quote;}
        if(quote)continue;
        if(c==='(')depth++; if(c===')')depth--;
        if(depth===0&&(c===';'||c===',')){parts.push({value:args.slice(start,i).trim(),sep:c}); start=i+1;}
      }
      parts.push({value:args.slice(start).trim(),sep:null});
      for(const p of parts){
        if(p.value) this.outputPart(this.evaluate(p.value));
        if(p.sep===',') { const spaces=14-(this.outputBuffer.length%14); this.outputBuffer+=' '.repeat(spaces); }
      }
      if(parts[parts.length-1].value || (parts.length===1 && !parts[0].sep)) { this.print(this.outputBuffer+'\n'); this.outputBuffer=''; }
    }
    parseTarget(text) {
      const match=text.trim().match(/^([A-Za-z_][A-Za-z0-9_]*[$%]?)\s*(?:\((.*)\))?$/i);
      if(!match) throw new BasicError('NEPAREIZS MAINĪGĀ NOSAUKUMS');
      return { name:upper(match[1]), indices:match[2]===undefined?null:splitOutside(match[2],',').map(x=>this.evaluate(x)) };
    }
    assign(target,value){const t=this.parseTarget(target);if(t.indices)this.setArray(t.name,t.indices,value);else this.setVar(t.name,value);}
    findEquals(text) { let quote=false,depth=0;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"')quote=!quote;if(quote)continue;if(c==='(')depth++;if(c===')')depth--;if(c==='='&&depth===0)return i;}return -1;}
    getCompiled(){
      const ordered=[...this.lines.entries()].sort((a,b)=>a[0]-b[0]);
      const instructions=[], locations=new Map(), data=[];
      for (const [line,code] of ordered) {
        locations.set(line,instructions.length);
        for(const statement of splitStatements(code)) {
          instructions.push({line,statement});
          if(/^DATA(?:\s|$)/i.test(statement)) {
            const raw=statement.replace(/^DATA\s*/i,'');
            for(const item of splitOutside(raw,',')) data.push({line,value:unquote(item)});
          }
        }
      }
      return {instructions,locations,data};
    }
    parseLineSpec(spec) {
      const s=spec.trim(); if(!s)return [null,null];
      const m=s.match(/^(\d+)?\s*(?:-|,)\s*(\d+)?$/);
      if(m)return [m[1]?Number(m[1]):null,m[2]?Number(m[2]):null];
      if(/^\d+$/.test(s))return [Number(s),Number(s)];
      throw new BasicError('NEPAREIZS RINDU DIAPAZONS');
    }
    async command(text) {
      const source=String(text).trim(); if(!source)return;
      if(this.running)throw new BasicError('PROGRAMMA JAU TIEK IZPILDĪTA');
      const line=source.match(/^(\d+)(?:\s+(.*))?$/);
      if(line) {
        const n=Number(line[1]); if(n<1||n>65535)throw new BasicError('NEPAREIZS RINDAS NUMURS');
        if(!line[2]||!line[2].trim())this.lines.delete(n);else this.lines.set(n,line[2].trim());return;
      }
      const m=source.match(/^([A-Za-z]+\$?|\?)(?:\s+(.*))?$/); const word=m?upper(m[1]):''; const rest=m?(m[2]||''):'';
      if(word==='RUN'||word==='RUNNH'){await this.run(rest);return;}
      if(word==='LIST'||word==='LLIST'){const [from,to]=this.parseLineSpec(rest);this.print((this.list(from,to)||'')+'\n');return;}
      if(word==='NEW'){this.lines.clear();this.resetState();this.print('JAUNA PROGRAMMA\n');return;}
      if(word==='CLEAR'){this.resetState();return;}
      if(word==='CLS'||word==='HOME'){this.hooks.clear();return;}
      if(word==='HELP'){this.print('RUN  LIST  NEW  RENUM  SAVE  LOAD  OLD  FILES  CLEAR  CLS\nPRINT  INPUT  LET  IF/THEN/ELSE  GOTO  FOR/NEXT  GOSUB/RETURN\nDIM  DATA/READ/RESTORE  ON/GOTO  END  STOP  REM\n');return;}
      if(word==='RENUM'){this.renumber(rest);return;}
      if(word==='SAVE'){this.save(rest);return;}
      if(word==='LOAD'||word==='OLD'){this.load(rest);return;}
      if(word==='FILES'||word==='DIR'){this.files();return;}
      if(word==='BYE'||word==='EXIT'){this.print('UZ REDZĒŠANOS!\n');return;}
      // Direct BASIC statements (including PRINT with no following whitespace, assignments).
      const context={pc:0,steps:0,interactive:true,compiled:{instructions:[],locations:new Map(),data:[]},jump:null,stopped:false};
      for(const stmt of splitStatements(source))await this.execute(stmt,context);
      this.flushOutput();
    }
    renumber(rest) {
      const args=rest.trim()?rest.split(/\s*,\s*/).map(x=>Number(x)):[];
      if(args.some(x=>!Number.isInteger(x)||x<=0))throw new BasicError('NEPAREIZI PĀRNUMURĒŠANAS PARAMETRI');
      const start=args[0]||10, step=args[1]||10;
      const old=[...this.lines.entries()].sort((a,b)=>a[0]-b[0]);const mapping=new Map(old.map(([n],i)=>[n,start+i*step]));
      if([...mapping.values()].some(n=>n>65535))throw new BasicError('RINDAS NUMURS PAR LIELU');
      const result=new Map();
      for(const [oldN,code] of old){
        // Replace only unambiguous line references, not arbitrary numbers in strings or expressions.
        let updated=code.replace(/\b(GOTO|GOSUB|THEN|ELSE|RESTORE)\s+(\d+)\b/gi,(m,word,n)=>mapping.has(Number(n))?word+' '+mapping.get(Number(n)):m);
        updated=updated.replace(/\b(ON\s+[^:]*?\s+GOTO\s+)([\d\s,]+)\b/gi,(_,prefix,nums)=>prefix+nums.replace(/\d+/g,x=>mapping.has(Number(x))?mapping.get(Number(x)):x));
        result.set(mapping.get(oldN),updated);
      }
      this.lines=result;this.print('RINDAS PĀRNUMURĒTAS\n');
    }
    storage() { const s=this.hooks.storage; if(!s)throw new BasicError('SAGLABĀŠANA NAV PIEEJAMA');return s; }
    normalizeFile(spec) {return upper(spec.trim().replace(/^DK\d+\s*:\s*/i,'').replace(/^"|"$/g,'').replace(/\.BAS$/i,'')||this.lastSaved).replace(/[^A-Z0-9_\-ĀČĒĢĪĶĻŅŠŪŽ]/g,'_').slice(0,40);}
    save(spec){
      if(/^LP\d+\s*:/i.test(spec)){this.print(this.list()+'\n');this.print('LISTINGS NOSŪTĪTS UZ LP1:\n');return;}
      const filename=this.normalizeFile(spec);this.storage().setItem('pecis.basic.file.'+filename,this.list());this.lastSaved=filename;this.print('SAGLABĀTS DK1:'+filename+'\n');
    }
    load(spec){const filename=this.normalizeFile(spec);const source=this.storage().getItem('pecis.basic.file.'+filename);if(source===null)throw new BasicError('FAILS NAV ATRASTS: '+filename);this.import(source);this.lastSaved=filename;this.print('IELĀDĒTS DK1:'+filename+'\n');}
    files(){const s=this.storage(),files=[];for(let i=0;i<s.length;i++){const k=s.key(i);if(k&&k.startsWith('pecis.basic.file.'))files.push(k.slice(17));}this.print(files.sort().join('   ')+'\n');}
    stop(){this.cancel=true;}
    jumpTo(ctx,line){const lineNum=Math.trunc(this.number(line));if(!ctx.compiled.locations.has(lineNum))throw new BasicError('RINDA '+lineNum+' NAV ATRASTA');ctx.jump=ctx.compiled.locations.get(lineNum);}
    parseIfStatement(text,ctx){
      const idx=positionOfWord(text,'THEN');if(idx<0)throw new BasicError('IF BEZ THEN');
      const cond=this.evaluate(text.slice(0,idx));const tail=text.slice(idx+4).trim();
      const pos=positionOfWord(tail,'ELSE');const part=this.truth(cond)?(pos>=0?tail.slice(0,pos):tail):(pos>=0?tail.slice(pos+4):'');
      return part.trim();
    }
    async execute(statement,ctx) {
      const src=statement.trim();if(!src)return;
      if(/^REM(?:\s|$)/i.test(src)||src.startsWith("'"))return;
      const m=src.match(/^([A-Za-z]+\$?|\?)(?=\W|$)\s*(.*)$/s);
      const cmd=m?upper(m[1]):'';let rest=m?m[2]:src;
      if(cmd==='PRINT'||cmd==='?'){this.printStatement(rest);return;}
      if(cmd==='LET'||this.findEquals(src)>=0 && !/^(IF|FOR|DEF|ON|DATA)\b/i.test(src)){
        const assign=cmd==='LET'?rest:src,idx=this.findEquals(assign);if(idx<0)throw new BasicError('NEPAREIZA PIEŠĶIRŠANA');
        this.assign(assign.slice(0,idx),this.evaluate(assign.slice(idx+1)));return;
      }
      if(cmd==='IF'){
        const branch=this.parseIfStatement(rest,ctx);if(!branch)return;
        if(/^\d+$/.test(branch)){this.jumpTo(ctx,Number(branch));return;}
        for(const piece of splitStatements(branch)){await this.execute(piece,ctx);if(ctx.jump!==null||ctx.stopped)break;}
        return;
      }
      if(cmd==='GOTO'||cmd==='GO'&&/^TO\s/i.test(rest)){this.jumpTo(ctx,this.evaluate(rest.replace(/^TO\s+/i,'')));return;}
      if(cmd==='GOSUB'){if(ctx.interactive)throw new BasicError('GOSUB TIKAI PROGRAMMĀ');ctx.callStack.push(ctx.pc+1);this.jumpTo(ctx,this.evaluate(rest));return;}
      if(cmd==='RETURN'){if(!ctx.callStack?.length)throw new BasicError('RETURN BEZ GOSUB');ctx.jump=ctx.callStack.pop();return;}
      if(cmd==='FOR'){
        if(ctx.interactive)throw new BasicError('FOR IZMANTO PROGRAMMĀ');
        const eq=this.findEquals(rest);if(eq<0)throw new BasicError('NEPAREIZS FOR');
        const name=upper(rest.slice(0,eq).trim());if(!/^[A-Z_][A-Z0-9_]*%?$/.test(name))throw new BasicError('NEPAREIZS FOR MAINĪGAIS');
        const tail=rest.slice(eq+1);const atTo=positionOfWord(tail,'TO');if(atTo<0)throw new BasicError('FOR BEZ TO');
        const atStep=positionOfWord(tail,'STEP',atTo+2);
        const begin=this.number(this.evaluate(tail.slice(0,atTo))),end=this.number(this.evaluate(tail.slice(atTo+2,atStep<0?undefined:atStep)));
        const step=atStep<0?1:this.number(this.evaluate(tail.slice(atStep+4)));
        if(step===0)throw new BasicError('FOR SOLIS NEDRĪKST BŪT 0');this.setVar(name,begin);
        const exit=(step>0?begin>end:begin<end);
        if(exit){const next=this.findMatchingNext(ctx.compiled.instructions,ctx.pc);ctx.jump=next+1;return;}
        ctx.loops.push({name,end,step,body:ctx.pc+1});return;
      }
      if(cmd==='NEXT'){
        const name=upper(rest.trim());if(!ctx.loops.length)throw new BasicError('NEXT BEZ FOR');
        const idx=name?ctx.loops.findLastIndex(x=>x.name===name):ctx.loops.length-1;
        if(idx<0)throw new BasicError('NEXT MAINĪGAIS NAV ATRASTS');
        const loop=ctx.loops[idx];const current=this.number(this.getVar(loop.name))+loop.step;this.setVar(loop.name,current);
        if(loop.step>0?current<=loop.end:current>=loop.end)ctx.jump=loop.body;
        else ctx.loops.splice(idx,1);
        return;
      }
      if(cmd==='DIM'){
        for(const spec of splitOutside(rest,',')){
          const match=spec.trim().match(/^([A-Za-z_][A-Za-z0-9_]*[$%]?)\s*\((.*)\)$/);
          if(!match)throw new BasicError('NEPAREIZS DIM');const name=upper(match[1]);
          if(this.arrays.has(name))throw new BasicError('MASĪVS JAU DEFINĒTS');
          const dims=splitOutside(match[2],',').map(v=>Math.trunc(this.number(this.evaluate(v))));
          if(dims.some(n=>n<0||n>50000)||dims.length>4)throw new BasicError('NEPAREIZS MASĪVA IZMĒRS');
          this.arrays.set(name,{dims,values:new Map()});
        }return;
      }
      if(cmd==='DATA')return;
      if(cmd==='READ'){
        for(const target of splitOutside(rest,',')){
          const item=ctx.compiled.data[ctx.dataIndex++];if(!item)throw new BasicError('PIETRŪKST DATA VĒRTĪBU');
          const t=this.parseTarget(target);const value=t.name.endsWith('$')?item.value:Number(item.value);
          if(!t.name.endsWith('$')&&!Number.isFinite(value))throw new BasicError('NEPAREIZA DATA VĒRTĪBA');
          this.assign(target,value);
        }return;
      }
      if(cmd==='RESTORE'){const line=rest.trim()?this.number(this.evaluate(rest)):null;ctx.dataIndex=line===null?0:((i)=>i<0?ctx.compiled.data.length:i)(ctx.compiled.data.findIndex(x=>x.line>=line));return;}
      if(cmd==='ON'){
        const match=rest.match(/^(.*?)\s+(GOTO|GOSUB)\s+(.+)$/i);if(!match)throw new BasicError('NEPAREIZS ON');
        const index=Math.trunc(this.number(this.evaluate(match[1])));const targets=splitOutside(match[3],',');
        if(index>=1&&index<=targets.length){if(upper(match[2])==='GOSUB')ctx.callStack.push(ctx.pc+1);this.jumpTo(ctx,this.evaluate(targets[index-1]));}return;
      }
      if(cmd==='INPUT'){
        const pieces=splitOutside(rest,';');let prompt='? ';
        if(pieces.length>1&&/^\s*"/.test(pieces[0])){prompt=String(this.evaluate(pieces.shift()))+'? ';rest=pieces.join(';');}
        else {const comma=splitOutside(rest,',');if(comma.length>1&&/^\s*"/.test(comma[0])){prompt=String(this.evaluate(comma.shift()))+'? ';rest=comma.join(',');}}
        const targets=splitOutside(rest,',');
        if(targets.some(t=>!t.trim()))throw new BasicError('NEPAREIZS INPUT');
        const reply=await this.hooks.input(prompt);
        if(this.cancel)throw new BasicError('PĀRTRAUKTS');
        const values=splitOutside(reply,',');if(values.length!==targets.length)throw new BasicError('NEPAREIZS IEVADES VĒRTĪBU SKAITS');
        for(let i=0;i<targets.length;i++){const t=this.parseTarget(targets[i]);const val=t.name.endsWith('$')?unquote(values[i]):Number(values[i].trim());if(!t.name.endsWith('$')&&!Number.isFinite(val))throw new BasicError('GAIDĪTS SKAITLIS');this.assign(targets[i],val);}
        return;
      }
      if(cmd==='END'||cmd==='STOP'){ctx.stopped=true;return;}
      if(cmd==='CLS'||cmd==='HOME'){this.hooks.clear();return;}
      if(cmd==='RANDOMIZE'){this.randomSeed=Date.now();return;}
      if(cmd==='BEEP'){this.print('\u0007');return;}
      throw new BasicError('NEZINĀMA KOMANDA: '+(cmd||src.split(/\s+/)[0]));
    }
    findMatchingNext(instructions,pc){let depth=0;for(let i=pc+1;i<instructions.length;i++){if(/^FOR\s/i.test(instructions[i].statement))depth++;if(/^NEXT(?:\s|$)/i.test(instructions[i].statement)){if(depth===0)return i;depth--;}}throw new BasicError('FOR BEZ NEXT');}
    async run(rest='') {
      if(this.running)throw new BasicError('PROGRAMMA JAU TIEK IZPILDĪTA');
      const compiled=this.getCompiled();this.resetState();this.cancel=false;
      const ctx={pc:0,jump:null,stopped:false,interactive:false,compiled,loops:[],callStack:[],dataIndex:0};
      if(rest.trim()){
        const arg=rest.trim();if(!/^\d+$/.test(arg))throw new BasicError('NEPAREIZS RUN PARAMETRS');
        if(!compiled.locations.has(Number(arg)))throw new BasicError('RINDA NAV ATRASTA');ctx.pc=compiled.locations.get(Number(arg));
      }
      let steps=0,currentLine=null;
      this.running=true;this.hooks.status('RUNNING');
      try {
        while(ctx.pc<compiled.instructions.length&&!ctx.stopped) {
          if(this.cancel)throw new BasicError('PĀRTRAUKTS');
          if(++steps>this.stepLimit)throw new BasicError('PĀRSNIEGTS IZPILDES SOĻU LIMITS');
          const ins=compiled.instructions[ctx.pc];currentLine=ins.line;ctx.jump=null;
          try {await this.execute(ins.statement,ctx);} catch(err){if(err instanceof BasicError&&err.line===null)err.line=currentLine;throw err;}
          ctx.pc=ctx.jump!==null?ctx.jump:ctx.pc+1;
          if(steps%200===0)await waitTick();
        }
        this.flushOutput();
        this.print('\nREADY\n');
      } catch(err){this.flushOutput();throw err;}
      finally {this.running=false;this.hooks.status('READY');}
    }
  }
  return { Interpreter, BasicError, splitStatements, tokenize };
});
