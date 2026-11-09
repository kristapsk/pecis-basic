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
    // BASIC-11 accepts both ASCII quotes and book-style guillemets («...»).
    // Normalize only for execution; LIST retains the original program text.
    // Backslashes outside strings separate statements.
    let normalized = '', quote = null;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quote === '"') {
        if (ch === '"') {
          if (source[i + 1] === '"') { normalized += '""'; i++; continue; }
          quote = null;
        }
        normalized += ch;
      } else if (quote === '»') {
        if (ch === '»') { normalized += '"'; quote = null; }
        else if (ch === '"') normalized += '""';
        else normalized += ch;
      } else if (ch === '"') { quote = '"'; normalized += ch; }
      else if (ch === '«') { quote = '»'; normalized += '"'; }
      // Only backslash separates BASIC-11 statements. Colons are literal,
      // including in REM text and in PRINT #F: or INPUT #F: syntax.
      else normalized += ch;
    }
    // A numeric THEN target is a jump, so statements after \ run only
    // when the condition is false. THEN PRINT ... \ PRINT ... stays one branch.
    const tokens = splitOutside(normalized, '\\'); const results = [];
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i].trim();
      if (/^IF\b.*\bTHEN\s+\d+$/i.test(item)) {
        results.push(item); continue;
      }
      // REM ends at the next backslash, not at the end of the source line.
      if (/^(?:IF\s|')/i.test(item)) {
        results.push(tokens.slice(i).join('\\').trim()); break;
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
        if (!closed) throw new BasicError('SYNTAX ERROR');
        out.push({ type: 'string', value: s }); continue;
      }
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/);
      if (number) { out.push({ type: 'number', value: Number(number[0]) }); i += number[0].length; continue; }
      const id = rest.match(/^[A-Za-z_][A-Za-z0-9_]*[$%¤]?/);
      if (id) { out.push({ type: 'id', value: upper(id[0]).replace(/¤$/, '$') }); i += id[0].length; continue; }
      const op = rest.match(/^(<=|>=|<>|!=|==|[+\-*/^=<>(),;])/);
      if (op) { out.push({ type: 'op', value: op[0] }); i += op[0].length; continue; }
      throw new BasicError('SYNTAX ERROR');
    }
    out.push({ type: 'eof', value: '' }); return out;
  }
  const priorities = { OR:1, AND:2, '=':3, '==':3, '<>':3, '!=':3, '<':3, '>':3, '<=':3, '>=':3, '+':4, '-':4, '*':5, '/':5, '^':7 };
  class ExpressionParser {
    constructor(runtime, text) { this.runtime = runtime; this.items = tokenize(text); this.at = 0; }
    peek() { return this.items[this.at]; }
    next() { return this.items[this.at++]; }
    eat(sym) { if (this.peek().value === sym) { this.at++; return true; } return false; }
    expect(sym) { if (!this.eat(sym)) throw new BasicError('SYNTAX ERROR'); }
    parse() { const value = this.expr(0); if (this.peek().type !== 'eof') throw new BasicError('SYNTAX ERROR'); return value; }
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
        } else if (tok.value === 'RND' || tok.value === 'CLK$' || tok.value === 'DAT$') {
          left = this.runtime.resolveCall(tok.value, []);
        } else left = this.runtime.getVar(tok.value);
      } else throw new BasicError('SYNTAX ERROR');
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
    if (!Number.isFinite(n)) throw new BasicError('OVERFLOW');
    if (Object.is(n, -0) || n === 0) return '0';
    // The book describes six significant digits in printed numeric results.
    // Keep ordinary values in decimal form; use E notation outside this range.
    const rounded = Number(n.toPrecision(6));
    const exponent = Math.floor(Math.log10(Math.abs(rounded)));
    if (exponent >= 6 || exponent < -4) {
      return rounded.toExponential(5).replace('e', 'E');
    }
    return String(Number(rounded.toFixed(Math.max(0, 5 - exponent))));
  }
  function unquote(str) { const s = str.trim(); return s.startsWith('"') && s.endsWith('"') ? s.slice(1,-1).replace(/""/g,'"') : s; }

  // A reply may contain several comma-delimited INPUT fields. Quoted strings
  // may contain commas and escaped double quotes ("").
  function parseInputValues(reply) {
    const source = String(reply), values = [];
    let i = 0;
    while (true) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] === '"') {
        i++;
        let value = '', closed = false;
        while (i < source.length) {
          if (source[i] === '"') {
            if (source[i + 1] === '"') { value += '"'; i += 2; continue; }
            i++; closed = true; break;
          }
          value += source[i++];
        }
        if (!closed) throw new BasicError('REDO FROM START');
        while (i < source.length && /\s/.test(source[i])) i++;
        if (i < source.length && source[i] !== ',') throw new BasicError('REDO FROM START');
        values.push(value);
      } else {
        const start = i;
        while (i < source.length && source[i] !== ',') {
          if (source[i] === '"') throw new BasicError('REDO FROM START');
          i++;
        }
        values.push(source.slice(start, i).trim());
      }
      if (i >= source.length) return values;
      i++; // Comma separates values only outside a quoted string.
    }
  }

  class Interpreter {
    constructor(hooks = {}) {
      this.hooks = { print: hooks.print || (()=>{}), input: hooks.input || (async ()=>''), clear: hooks.clear || (()=>{}), storage: hooks.storage || null, status: hooks.status || (()=>{}), linePrinter: hooks.linePrinter || null, exit: hooks.exit || (()=>{}) };
      this.lines = new Map(); this.virtualFiles = new Map(); this.resetState(); this.running = false; this.cancel = false;
      this.lastSaved = 'PROGRAMMA'; this.stepLimit = 1000000;
      this.programName = 'PROGRAMMA'; this.programCreated = new Date().toISOString();
    }
    listHeader() {
      const date = new Date(this.programCreated);
      const pad = n => String(n).padStart(2, '0');
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      return this.programName + '   ' + pad(date.getDate()) + '-' + months[date.getMonth()]
        + '-' + pad(date.getFullYear() % 100) + '   ' + pad(date.getHours())
        + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    }
    resetState() { this.vars = new Map(); this.arrays = new Map(); this.userFunctions = new Map(); this.functionDepth = 0; this.loops = []; this.returns = []; this.dataAt = 0; this.outputBuffer = ''; this.randomSeed = 0x12345678; this.fileChannels = new Map(); }
    number(x) { const n = Number(x); if (!Number.isFinite(n)) throw new BasicError('TYPE MISMATCH'); return n; }
    truth(x) { return typeof x === 'string' ? x.length > 0 : this.number(x) !== 0; }
    getVar(name) { return this.vars.has(name) ? this.vars.get(name) : name.endsWith('$') ? '' : 0; }
    defineFunction(spec) {
      // BASIC-11 function names are FN + one letter, optionally suffixed by % or $.
      // The currency sign (U+00A4) is the historical spelling of $.
      const match=spec.match(/^\s*(FN[A-Za-z][$%¤]?)\s*(?:\(([^()]*)\))?\s*=\s*(.+)$/s);
      if(!match)throw new BasicError('SYNTAX ERROR');
      const name=upper(match[1]).replace(/¤$/, '$');
      const params=match[2]===undefined||!match[2].trim()?[]:match[2].split(',').map(x=>upper(x.trim()).replace(/¤$/, '$'));
      if(params.length>5||params.some(x=>!/^[A-Z][A-Z0-9_]*[$%]?$/.test(x))||new Set(params).size!==params.length)
        throw new BasicError('SYNTAX ERROR');
      if(this.userFunctions.has(name))throw new BasicError('FUNCTION ALREADY DEFINED');
      this.userFunctions.set(name,{params,expression:match[3].trim()});
    }
    callUserFunction(name,args) {
      const fn=this.userFunctions.get(name);
      if(!fn)throw new BasicError('UNDEFINED FUNCTION');
      if(fn.params.length!==args.length)throw new BasicError('ILLEGAL FUNCTION CALL');
      if(this.functionDepth>=32)throw new BasicError('OUT OF TIME');
      const saved=this.vars;
      this.vars=new Map(saved);this.functionDepth++;
      try {
        for(let i=0;i<args.length;i++){
          const param=fn.params[i],value=args[i];
          if(param.endsWith('$')!== (typeof value==='string'))throw new BasicError('TYPE MISMATCH');
          this.setVar(param,value);
        }
        const result=this.evaluate(fn.expression);
        if(name.endsWith('$')){
          if(typeof result!=='string')throw new BasicError('TYPE MISMATCH');
          return result;
        }
        if(typeof result!=='number')throw new BasicError('TYPE MISMATCH');
        const number=this.number(result);
        return name.endsWith('%')?Math.trunc(number):number;
      } finally {this.vars=saved;this.functionDepth--;}
    }
    setVar(name, value) {
      if (name.endsWith('$')) this.vars.set(name, String(value));
      else { const num = this.number(value); this.vars.set(name, name.endsWith('%') ? Math.trunc(num) : num); }
    }
    keyFor(indices) { return indices.map(n=>{ if (n < 0 || !Number.isInteger(n)) throw new BasicError('BAD SUBSCRIPT'); return n; }).join(','); }
    array(name, indices) {
      let entry = this.arrays.get(name);
      if (!entry) { entry = { dims: indices.map(()=>10), values: new Map() }; this.arrays.set(name, entry); }
      if (indices.length !== entry.dims.length || indices.some((n,i)=>n>entry.dims[i])) throw new BasicError('BAD SUBSCRIPT');
      return entry;
    }
    getArray(name, indices) { const a=this.array(name,indices.map(x=>Math.trunc(this.number(x)))); const key=this.keyFor(indices.map(x=>Math.trunc(this.number(x)))); return a.values.has(key) ? a.values.get(key) : name.endsWith('$')?'':0; }
    setArray(name, indices, val) { indices=indices.map(x=>Math.trunc(this.number(x))); const a=this.array(name,indices), key=this.keyFor(indices); a.values.set(key, name.endsWith('$') ? String(val) : this.number(val)); }
    binary(op,a,b) {
      if (op === 'AND') return this.truth(a) && this.truth(b) ? -1 : 0;
      if (op === 'OR') return this.truth(a) || this.truth(b) ? -1 : 0;
      if (['=','==','<>','!=','<','>','<=','>='].includes(op)) {
        if (typeof a !== typeof b) throw new BasicError('TYPE MISMATCH');
        const ok = ({ '=':()=>a===b, '==':()=>a===b, '<>':()=>a!==b, '!=':()=>a!==b, '<':()=>a<b, '>':()=>a>b, '<=':()=>a<=b, '>=':()=>a>=b })[op]();
        return ok ? -1 : 0;
      }
      if (op === '+' && typeof a==='string' && typeof b==='string') return a+b;
      const x=this.number(a), y=this.number(b);
      if (op==='/' && y===0) throw new BasicError('DIVISION BY ZERO');
      const fn={'+':()=>x+y,'-':()=>x-y,'*':()=>x*y,'/':()=>x/y,'^':()=>Math.pow(x,y)}[op];
      if (!fn) throw new BasicError('SYNTAX ERROR');
      const value=fn(); if (!Number.isFinite(value)) throw new BasicError('OVERFLOW'); return value;
    }
    resolveCall(name,args) {
      if(/^FN[A-Z][$%]?$/.test(name))return this.callUserFunction(name,args);
      const n=i=>this.number(args[i]), s=i=>String(args[i]);
      const funcs={
        'ABS':()=>Math.abs(n(0)), 'INT':()=>Math.floor(n(0)), 'FIX':()=>Math.trunc(n(0)),
        'SGN':()=>Math.sign(n(0)), 'SQR':()=>Math.sqrt(n(0)), 'SIN':()=>Math.sin(n(0)),
        'COS':()=>Math.cos(n(0)), 'TAN':()=>Math.tan(n(0)), 'ATN':()=>Math.atan(n(0)),
        'LOG':()=>Math.log(n(0)), 'EXP':()=>Math.exp(n(0)),
        'RND':()=>{
          // BASIC-11 ignores its optional numeric argument. RUN resets the sequence.
          if(args.length===1)n(0);
          this.randomSeed=(Math.imul(1664525,this.randomSeed)+1013904223)>>>0;
          return (this.randomSeed+0.5)/4294967296;
        }, 'LEN':()=>s(0).length,
        'CLK$':()=>{
          if(args.length)throw new BasicError('ILLEGAL FUNCTION CALL');
          const d=new Date(),pad=x=>String(x).padStart(2,'0');
          return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
        },
        'DAT$':()=>{
          if(args.length)throw new BasicError('ILLEGAL FUNCTION CALL');
          const d=new Date(),pad=x=>String(x).padStart(2,'0');
          const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          return pad(d.getDate())+'-'+months[d.getMonth()]+'-'+pad(d.getFullYear()%100);
        },
        'POS':()=>{
          if(args.length!==3)throw new BasicError('ILLEGAL FUNCTION CALL');
          if(typeof args[0]!=='string'||typeof args[1]!=='string')throw new BasicError('TYPE MISMATCH');
          const start=this.number(args[2]);
          if(!Number.isInteger(start)||start<1)throw new BasicError('ILLEGAL FUNCTION CALL');
          if(!args[1].length)return 0;
          const index=args[0].indexOf(args[1],start-1);
          return index<0?0:index+1;
        },
        'ASC':()=>s(0).length?s(0).charCodeAt(0):0,
        'CHR$':()=>String.fromCharCode(n(0)), 'STR$':()=>formatNum(n(0)),
        'VAL':()=>{
          if(typeof args[0]!=='string')throw new BasicError('TYPE MISMATCH');
          const text=args[0].trim();
          if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text))
            throw new BasicError('ILLEGAL FUNCTION CALL');
          return this.number(Number(text));
        },
        'LEFT$':()=>s(0).slice(0,Math.max(0,Math.trunc(n(1)))),
        'RIGHT$':()=>{const count=Math.max(0,Math.trunc(n(1)));return count?s(0).slice(-count):'';},
        'MID$':()=>s(0).slice(Math.max(0,Math.trunc(n(1))-1), args.length===3?Math.max(0,Math.trunc(n(1))-1)+Math.max(0,Math.trunc(n(2))):undefined),
        // BASIC-11 SEG$(text, first, last): inclusive, 1-based positions.
        // The tokenizer already maps the historical SEG¤ spelling to SEG$.
        'SEG$':()=>{
          if(args.length!==3)throw new BasicError('ILLEGAL FUNCTION CALL');
          if(typeof args[0]!=='string')throw new BasicError('TYPE MISMATCH');
          const first=n(1),last=n(2);
          if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first)
            throw new BasicError('ILLEGAL FUNCTION CALL');
          return args[0].slice(first-1,last);
        },
        'TAB':()=>({ spacing:'TAB', value:n(0) }), 'SPC':()=>({ spacing:'SPC', value:n(0) })
      };
      // Validate built-in functions before evaluating their implementations.
      const arities={
        ABS:[1],INT:[1],FIX:[1],SGN:[1],SQR:[1],SIN:[1],COS:[1],TAN:[1],
        ATN:[1],LOG:[1],EXP:[1],RND:[0,1],LEN:[1], 'CLK$':[0], 'DAT$':[0],
        POS:[3],ASC:[1], 'CHR$':[1], 'STR$':[1],VAL:[1],
        'LEFT$':[2], 'RIGHT$':[2], 'MID$':[2,3], 'SEG$':[3],TAB:[1],SPC:[1]
      };
      if (Object.prototype.hasOwnProperty.call(funcs,name)) {
        if(!arities[name].includes(args.length))throw new BasicError('ILLEGAL FUNCTION CALL');
        if((name==='TAB'||name==='SPC')&&this.number(args[0])<0)
          throw new BasicError('ILLEGAL FUNCTION CALL');
        const result=funcs[name](); if (typeof result === 'number' && !Number.isFinite(result)) throw new BasicError('ILLEGAL FUNCTION CALL'); return result;
      }
      return this.getArray(name,args);
    }
    evaluate(expr) { return new ExpressionParser(this, expr).parse(); }
    list(from=null,to=null) { return [...this.lines.entries()].sort((a,b)=>a[0]-b[0]).filter(([n])=>(from===null||n>=from)&&(to===null||n<=to)).map(([n,v])=>n+' '+v).join('\n'); }
    import(text) { const fresh=new Map(); for (const line of String(text).split(/\r?\n/)) { if (!line.trim()) continue; const m=line.match(/^\s*(\d+)\s*(.*)$/); if (!m) throw new BasicError('SYNTAX ERROR'); const n=Number(m[1]); if (n<=0||n>65535) throw new BasicError('BAD LINE NUMBER'); if (m[2].trim()) fresh.set(n,m[2].trim()); } this.lines=fresh; this.programName='PROGRAMMA'; this.programCreated=new Date().toISOString(); }
    print(msg) { this.hooks.print(String(msg)); }
    flushOutput() { if (this.outputBuffer) { this.print(this.outputBuffer+'\n'); this.outputBuffer=''; } }
    outputPart(value) {
      if (value && typeof value==='object' && value.spacing) {
        // BASIC-11 TAB uses zero-based columns; it never moves the cursor backward.
        const pos=this.outputBuffer.length;
        const count=value.spacing==='SPC'?Math.trunc(value.value):Math.max(0,Math.trunc(value.value)-pos);
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
      const match=text.trim().match(/^([A-Za-z_][A-Za-z0-9_]*[$%¤]?)\s*(?:\((.*)\))?$/i);
      if(!match) throw new BasicError('SYNTAX ERROR');
      return { name:upper(match[1]).replace(/¤$/, '$'), indices:match[2]===undefined?null:splitOutside(match[2],',').map(x=>this.evaluate(x)) };
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
      throw new BasicError('BAD LINE RANGE');
    }
    async command(text) {
      const source=String(text).trim(); if(!source)return;
      if(this.running)throw new BasicError('PROGRAM ALREADY RUNNING');
      const line=source.match(/^(\d+)\s*(.*)$/);
      if(line) {
        const n=Number(line[1]); if(n<1||n>65535)throw new BasicError('BAD LINE NUMBER');
        if(!line[2]||!line[2].trim())this.lines.delete(n);else this.lines.set(n,line[2].trim());return;
      }
      const m=source.match(/^([A-Za-z]+\$?|\?)(?:\s+(.*))?$/); const word=m?upper(m[1]):''; const rest=m?(m[2]||''):'';
      if(/^SUB(?=\s*\d)/i.test(source)){this.substitute(source.slice(3));return;}
      if(word==='RUN'||word==='RUNNH'){await this.run(rest,word==='RUN');return;}
      if(word==='LIST'||word==='LLIST'){const [from,to]=this.parseLineSpec(rest);this.print('\n'+this.listHeader()+'\n\n'+(this.list(from,to)||'')+'\n');return;}
      if(word==='LISTNH'){const [from,to]=this.parseLineSpec(rest);this.print((this.list(from,to)||'')+'\n');return;}
      if(word==='NEW'){this.lines.clear();this.resetState();this.programName=upper(rest.trim()||'PROGRAMMA');this.programCreated=new Date().toISOString();return;}
      if(word==='CLEAR'){this.resetState();return;}
      if(word==='CLS'||word==='HOME'){this.hooks.clear();return;}
      if(word==='HELP'){this.print('RUN  LIST  LISTNH  SUB  NEW  RESEQ  RENUM  SAVE  LOAD  OLD  FILES  CLEAR  CLS\nPRINT  INPUT  LINPUT  LET  IF/THEN/ELSE  GOTO  FOR/NEXT  GOSUB/RETURN\nDIM  DATA/READ/RESTORE  ON/GOTO  END  STOP  REM\n');return;}
      if(word==='RENUM'){this.renumber(rest);return;}
      if(word==='RESEQ'){this.resequence(rest);return;}
      if(word==='SAVE'){this.save(rest);return;}
      if(word==='KILL'){this.killFile(rest);return;}
      if(word==='LOAD'||word==='OLD'){this.load(rest);return;}
      if(word==='FILES'||word==='DIR'){this.files();return;}
      if(word==='BYE'||word==='EXIT'){this.hooks.exit();return;}
      // Direct BASIC statements (including PRINT with no following whitespace, assignments).
      const context={pc:0,steps:0,interactive:true,compiled:{instructions:[],locations:new Map(),data:[]},jump:null,stopped:false};
      for(const stmt of splitStatements(source))await this.execute(stmt,context);
      this.flushOutput();
    }
    substitute(spec) {
      // BASIC-11: SUB line delimiter old delimiter new delimiter [occurrence].
      // The substitution applies to the LISTed line, including its number.
      const match=spec.trim().match(/^(\d+)\s*(\S)([\s\S]*)$/);
      if(!match || /\d/.test(match[2]))throw new BasicError('SUBSTITUTE ERROR');
      const oldLine=Number(match[1]), delimiter=match[2], tail=match[3];
      if(!this.lines.has(oldLine))throw new BasicError('UNDEFINED LINE');
      const middle=tail.indexOf(delimiter);
      const end=middle<0?-1:tail.indexOf(delimiter,middle+1);
      if(middle<=0 || end<0)throw new BasicError('SUBSTITUTE ERROR');
      const before=tail.slice(0,middle), after=tail.slice(middle+1,end);
      const suffix=tail.slice(end+1).trim();
      if(suffix && !/^[1-9]\d*$/.test(suffix))throw new BasicError('SUBSTITUTE ERROR');
      const occurrence=suffix?Number(suffix):1;
      if(!Number.isSafeInteger(occurrence))throw new BasicError('SUBSTITUTE ERROR');
      const original=oldLine+' '+this.lines.get(oldLine);
      let at=-1, start=0;
      for(let i=0;i<occurrence;i++){
        at=original.indexOf(before,start);
        if(at<0)break;
        start=at+before.length;
      }
      if(at<0){this.print(original+'\n');return;}
      const changed=original.slice(0,at)+after+original.slice(at+before.length);
      const parsed=changed.match(/^(\d+)\s+(.+)$/);
      if(!parsed || Number(parsed[1])<1 || Number(parsed[1])>65535)
        throw new BasicError('SUBSTITUTE ERROR');
      const newLine=Number(parsed[1]);
      // Changing the line number copies the line rather than deleting the old one.
      this.lines.set(newLine,parsed[2]);
      this.print(newLine+' '+parsed[2]+'\n');
    }
    renumber(rest) {
      const args=rest.trim()?rest.split(/\s*,\s*/).map(x=>Number(x)):[];
      if(args.some(x=>!Number.isInteger(x)||x<=0))throw new BasicError('SYNTAX ERROR');
      const start=args[0]||10, step=args[1]||10;
      const old=[...this.lines.entries()].sort((a,b)=>a[0]-b[0]);const mapping=new Map(old.map(([n],i)=>[n,start+i*step]));
      if([...mapping.values()].some(n=>n>65535))throw new BasicError('BAD LINE NUMBER');
      const result=new Map();
      for(const [oldN,code] of old){
        // Replace only unambiguous line references, not arbitrary numbers in strings or expressions.
        let updated=code.replace(/\b(GOTO|GO\s+TO|GOSUB|THEN|ELSE|RESTORE)\s+(\d+)\b/gi,(m,word,n)=>mapping.has(Number(n))?word+' '+mapping.get(Number(n)):m);
        updated=updated.replace(/\b(ON\s+[^:]*?\s+(?:GOTO|GO\s+TO)\s+)([\d\s,]+)\b/gi,(_,prefix,nums)=>prefix+nums.replace(/\d+/g,x=>mapping.has(Number(x))?mapping.get(Number(x)):x));
        result.set(mapping.get(oldN),updated);
      }
      this.lines=result;this.print('RINDAS PĀRNUMURĒTAS\n');
    }
    resequence(rest) {
      // BASIC-11: RESEQ [new-start],[old-start][-old-end][,step].
      // RESEQ without arguments numbers the complete program 10,20,30,...
      const spec=rest.trim();
      let newStart=null, from=null, to=null, step=10;
      if (/^\d+$/.test(spec)) {
        newStart=Number(spec);
      } else if (spec) {
        const match=spec.match(/^(?:(\d*)\s*,\s*)?(\d*\s*(?:-\s*\d*)?)?(?:\s*,\s*(\d+))?$/);
        if (!match || (!match[1] && !match[2] && !match[3]))
          throw new BasicError('SYNTAX ERROR');
        if (match[1]) newStart=Number(match[1]);
        if (match[3]) step=Number(match[3]);
        const range=(match[2]||'').replace(/\s/g,'');
        if (range.includes('-')) {
          const [a,b]=range.split('-');
          if(a)from=Number(a);
          if(b)to=Number(b);
        } else if(range)from=Number(range);
      }
      if (!Number.isInteger(step)||step<=0 || (newStart!==null&&(!Number.isInteger(newStart)||newStart<=0)) ||
          (from!==null&&from<=0) || (to!==null&&to<=0) ||
          (from!==null&&to!==null&&from>to))
        throw new BasicError('SYNTAX ERROR');
      const old=[...this.lines.entries()].sort((a,b)=>a[0]-b[0]);
      const selected=old.filter(([n])=>(from===null||n>=from)&&(to===null||n<=to));
      if (!selected.length)return;
      if (newStart===null) {
        const previous=old.filter(([n])=>n<selected[0][0]);
        newStart=(previous.length?previous[previous.length-1][0]:0)+step;
      }
      const mapping=new Map(selected.map(([n],i)=>[n,newStart+i*step]));
      const selectedNumbers=new Set(mapping.keys());
      const unaffected=new Set(old.filter(([n])=>!selectedNumbers.has(n)).map(([n])=>n));
      if ([...mapping.values()].some(n=>n>65535||unaffected.has(n)))
        throw new BasicError('LINE NUMBER CONFLICT');
      const result=new Map();
      for(const [oldN,code] of old){
        // Preserve references from every line, including lines outside the range.
        let updated=code.replace(/\b(GOTO|GO\s+TO|GOSUB|THEN|ELSE|RESTORE)\s+(\d+)\b/gi,
          (m,word,n)=>mapping.has(Number(n))?word+' '+mapping.get(Number(n)):m);
        updated=updated.replace(/\b(ON\s+[^:]*?\s+(?:GOTO|GO\s+TO)\s+)([\d\s,]+)\b/gi,
          (_,prefix,nums)=>prefix+nums.replace(/\d+/g,x=>mapping.has(Number(x))?mapping.get(Number(x)):x));
        result.set(mapping.get(oldN)??oldN,updated);
      }
      this.lines=result;
    }
    storage() { const s=this.hooks.storage; if(!s)throw new BasicError('DEVICE NOT AVAILABLE');return s; }
    normalizeFile(spec) {return upper(spec.trim().replace(/^DK\d+\s*:\s*/i,'').replace(/^"|"$/g,'').replace(/\.BAS$/i,'')||this.lastSaved).replace(/[^A-Z0-9_\-ĀČĒĢĪĶĻŅŠŪŽ]/g,'_').slice(0,40);}
    // Programs and sequential data live in the same virtual disk namespace.
    // The command determines the DEFAULT extension, not a different filesystem.
    filePath(filename,extension='DAT') {
      let text=upper(String(filename).trim().replace(/^"|"$/g,''));
      if(!text)throw new BasicError('BAD FILE NAME');
      if(!/^[A-Z0-9]+:/.test(text))text='DK1:'+text;
      const match=text.match(/^(DK\d+):([A-Z0-9_\-ĀČĒĢĪĶĻŅŠŪŽ]+)(?:\.([A-Z0-9]+))?$/);
      if(!match)throw new BasicError('BAD FILE NAME');
      return match[1]+':'+match[2]+'.'+(match[3]||extension);
    }
    // Shared VFS metadata: stored alongside the file and retained on rewrites.
    // Existing pecis.basic.meta.* entries are migrated without losing creation time.
    fileMetadata(path,created=null) {
      const key='pecis.basic.vfsmeta.'+path;
      let raw=this.hooks.storage?.getItem(key) ?? this.virtualFiles.get(key) ?? null;
      const legacy=path.match(/^DK1:([^.]+)\.BAS$/);
      if(raw===null&&legacy)raw=this.hooks.storage?.getItem('pecis.basic.meta.'+legacy[1]) ?? null;
      let meta={};
      if(raw!==null){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))meta=parsed;}catch(_){/* Recover malformed metadata. */}}
      if(!meta.created||Number.isNaN(Date.parse(meta.created)))
        meta.created=(created&&!Number.isNaN(Date.parse(created)))?created:new Date().toISOString();
      if(!meta.name&&path.endsWith('.BAS'))meta.name=path.slice(path.indexOf(':')+1,-4);
      const serialized=JSON.stringify(meta);
      this.virtualFiles.set(key,serialized);
      if(this.hooks.storage?.getItem(key)!==serialized)this.hooks.storage?.setItem(key,serialized);
      return meta;
    }
    fileRead(path) {
      const key='pecis.basic.vfs.'+path;
      let value=this.hooks.storage?.getItem(key) ?? this.virtualFiles.get(key) ?? null;
      // Read old SAVE/LOAD entries and migrate them on first access.
      const legacy=path.match(/^DK1:([^.]+)\.BAS$/);
      if(value===null&&legacy){
        value=this.hooks.storage?.getItem('pecis.basic.file.'+legacy[1]) ?? null;
        if(value!==null)this.fileWrite(path,value);
      }
      if(value!==null)this.fileMetadata(path);
      return value;
    }
    fileWrite(path,value,created=null) {
      // Preserve original creation date if a file is overwritten.
      this.fileMetadata(path,created);
      const key='pecis.basic.vfs.'+path;
      this.virtualFiles.set(key,String(value));
      this.hooks.storage?.setItem(key,String(value));
    }
    killFile(spec) {
      // BASIC-11 KILL deletes a named file, defaulting to .DAT.
      // Delete metadata and legacy SAVE keys so deleted files cannot reappear.
      const filename=this.evaluate(spec.trim());
      if(typeof filename!=='string'||!filename.trim())throw new BasicError('BAD FILE NAME');
      const path=this.filePath(filename,'DAT');
      if([...this.fileChannels.values()].some(channel=>channel.path===path))
        throw new BasicError('FILE ALREADY OPEN');
      const key='pecis.basic.vfs.'+path,metaKey='pecis.basic.vfsmeta.'+path;
      const legacy=path.match(/^DK1:([^.]+)\.BAS$/);
      const oldKey=legacy?'pecis.basic.file.'+legacy[1]:null;
      const oldMetaKey=legacy?'pecis.basic.meta.'+legacy[1]:null;
      const storage=this.hooks.storage;
      const exists=this.virtualFiles.has(key)||(storage?.getItem(key)??null)!==null
        ||(oldKey!==null&&(storage?.getItem(oldKey)??null)!==null);
      if(!exists)throw new BasicError('FILE NOT FOUND: '+path);
      if(storage&&typeof storage.removeItem!=='function')throw new BasicError('DEVICE NOT AVAILABLE');
      this.virtualFiles.delete(key);
      this.virtualFiles.delete(metaKey);
      for(const k of [key,metaKey,oldKey,oldMetaKey])if(k)storage?.removeItem(k);
    }
    save(spec){
      // LP: (as in the book) and LP1: are printer device identifiers, not filenames.
      const printer=String(spec).trim().match(/^LP(1)?\s*:\s*$/i);
      if(printer){
        const job={device:'LP1',name:this.programName,created:this.programCreated,
          text:this.listHeader()+'\n\n'+this.list()+'\n'};
        if(this.hooks.linePrinter)this.hooks.linePrinter(job);
        else this.print(job.text);
        return;
      }
      this.storage();
      const path=this.filePath(spec.trim()||this.lastSaved,'BAS');
      const filename=path.slice(path.indexOf(':')+1).replace(/\.BAS$/,'');
      // On initial SAVE the program's creation date becomes the file's date.
      // Further SAVE calls preserve the timestamp of the existing file.
      this.fileWrite(path,this.list(),this.programCreated);
      this.programName=filename;
      this.lastSaved=filename;this.print('SAGLABĀTS '+path.replace(/\.BAS$/,'')+'\n');
    }
    load(spec){
      this.storage();
      const path=this.filePath(spec.trim()||this.lastSaved,'BAS');
      const source=this.fileRead(path);
      if(source===null)throw new BasicError('FILE NOT FOUND: '+path);
      this.import(source);
      const filename=path.slice(path.indexOf(':')+1).replace(/\.BAS$/,'');
      this.programName=filename;
      this.programCreated=this.fileMetadata(path).created;
      this.lastSaved=filename;this.print('IELĀDĒTS '+path.replace(/\.BAS$/,'')+'\n');
    }
    files(){
      const names=new Set(),prefix='pecis.basic.vfs.',legacy='pecis.basic.file.';
      for(const key of this.virtualFiles.keys())if(key.startsWith(prefix))names.add(key.slice(prefix.length));
      const s=this.hooks.storage;
      if(s)for(let i=0;i<s.length;i++){
        const key=s.key(i);
        if(key?.startsWith(prefix))names.add(key.slice(prefix.length));
        if(key?.startsWith(legacy))names.add('DK1:'+key.slice(legacy.length)+'.BAS');
      }
      this.print([...names].sort().join('   ')+'\n');
    }
    stop(){this.cancel=true;}
    jumpTo(ctx,line){const lineNum=Math.trunc(this.number(line));if(!ctx.compiled.locations.has(lineNum))throw new BasicError('UNDEFINED LINE');ctx.jump=ctx.compiled.locations.get(lineNum);}
    parseIfStatement(text,ctx){
      const idx=positionOfWord(text,'THEN');if(idx<0)throw new BasicError('IF WITHOUT THEN');
      const cond=this.evaluate(text.slice(0,idx));const tail=text.slice(idx+4).trim();
      const pos=positionOfWord(tail,'ELSE');const part=this.truth(cond)?(pos>=0?tail.slice(0,pos):tail):(pos>=0?tail.slice(pos+4):'');
      return part.trim();
    }
    // A channel is an open view on a file in the shared virtual disk.
    fileNumber(expr) {
      const number=this.number(this.evaluate(expr.trim().replace(/^#\s*/,'')));
      if(!Number.isInteger(number)||number<1||number>127)throw new BasicError('BAD FILE NUMBER');
      return number;
    }
    fileChannel(expr,mode) {
      const channel=this.fileChannels.get(this.fileNumber(expr));
      if(!channel||channel.mode!==mode)throw new BasicError('FILE NOT OPEN');
      return channel;
    }
    openFile(spec) {
      const match=spec.match(/^(.+?)\s+FOR\s+(INPUT|OUTPUT)\s+AS\s+(?:FILE\s+)?#?\s*(.+)$/i);
      if(!match)throw new BasicError('SYNTAX ERROR');
      const filename=this.evaluate(match[1].trim());
      if(typeof filename!=='string'||!filename.trim())throw new BasicError('TYPE MISMATCH');
      const number=this.fileNumber(match[3]);
      if(this.fileChannels.has(number))throw new BasicError('FILE ALREADY OPEN');
      const printer=/^LP\d*:$/.test(upper(filename.trim())),mode=upper(match[2]);
      if(printer&&mode!=='OUTPUT')throw new BasicError('DEVICE NOT AVAILABLE');
      const path=printer?null:this.filePath(filename,'DAT');
      const saved=path?this.fileRead(path):null;
      if(mode==='INPUT'&&saved===null)throw new BasicError('FILE NOT FOUND');
      const lines=mode==='INPUT'?String(saved).split(/\r?\n/):[];
      if(mode==='INPUT'&&lines.at(-1)==='')lines.pop();
      this.fileChannels.set(number,{path,mode,printer,lines,index:0,values:[],chunks:[],pending:''});
    }
    printFile(spec) {
      // BASIC-11 accepts PRINT #F,expr, PRINT #F;expr, PRINT #F:expr
      // and PRINT #F with no arguments (a blank line / flush).
      const match=spec.match(/^#\s*([^;:,\s]+)\s*(?:([;:,])\s*([\s\S]*))?$/);
      if(!match)throw new BasicError('SYNTAX ERROR');
      // BASIC-11 channel 0 is the terminal and needs no OPEN.
      // Other channels still require OPEN and a valid file number.
      if(this.number(this.evaluate(match[1]))===0){
        this.printStatement(match[3]??'');
        return;
      }
      const channel=this.fileChannel(match[1],'OUTPUT');
      const output=this.outputBuffer,print=this.hooks.print;
      this.outputBuffer=channel.pending;
      this.hooks.print=text=>channel.chunks.push(text);
      try {this.printStatement(match[3]??'');channel.pending=this.outputBuffer;}
      finally {this.outputBuffer=output;this.hooks.print=print;}
    }
    async lineInput(spec) {
      // BASIC-11 LINPUT reads physical lines, without CSV or quote processing.
      let channel = null, prompt = '? ', targetsText = spec;
      if (/^\s*#/.test(spec)) {
        const match = spec.match(/^\s*#\s*([^;:,]+)\s*[;:,]\s*(.+)$/);
        if (!match) throw new BasicError('SYNTAX ERROR');
        const number = this.number(this.evaluate(match[1]));
        if (number === 0) prompt = '';
        else {
          if (!Number.isInteger(number) || number < 1 || number > 127) throw new BasicError('BAD FILE NUMBER');
          channel = this.fileChannels.get(number);
          if (!channel || channel.mode !== 'INPUT') throw new BasicError('FILE NOT OPEN');
        }
        targetsText = match[2];
      }
      const targets = splitOutside(targetsText, ',');
      if (targets.some(target => !target.trim())) throw new BasicError('SYNTAX ERROR');
      // INPUT # may have buffered fields from its preceding physical line.
      if (channel) channel.values = [];
      else if (this.outputBuffer) { this.print(this.outputBuffer); this.outputBuffer = ''; }
      for (const text of targets) {
        const target = this.parseTarget(text);
        if (!target.name.endsWith('$')) throw new BasicError('TYPE MISMATCH');
        let value;
        if (channel) {
          if (channel.index >= channel.lines.length) throw new BasicError('OUT OF DATA');
          value = channel.lines[channel.index++];
        } else {
          value = await this.hooks.input(prompt);
          if (this.cancel || value == null) throw new BasicError('BREAK');
          value = String(value);
        }
        if (target.indices) this.setArray(target.name, target.indices, value);
        else this.setVar(target.name, value);
      }
    }
    inputFile(spec) {
      const match=spec.match(/^#\s*([^;:,]+)\s*[;:,]\s*(.+)$/);
      if(!match)throw new BasicError('SYNTAX ERROR');
      const channel=this.fileChannel(match[1],'INPUT'),targets=splitOutside(match[2],',');
      if(targets.some(t=>!t.trim()))throw new BasicError('SYNTAX ERROR');
      for(const target of targets){
        while(!channel.values.length){
          if(channel.index>=channel.lines.length)throw new BasicError('OUT OF DATA');
          const line=channel.lines[channel.index++];
          if(!line.trim())continue;
          channel.values=parseInputValues(line);
        }
        const t=this.parseTarget(target),raw=channel.values.shift();
        const val=t.name.endsWith('$')?raw:Number(raw);
        if(!t.name.endsWith('$')&&!Number.isFinite(val))throw new BasicError('TYPE MISMATCH');
        this.assign(target,val);
      }
    }
    closeFiles(spec='') {
      const numbers=spec.trim()?splitOutside(spec,',').map(item=>this.fileNumber(item)):[...this.fileChannels.keys()];
      for(const number of numbers){
        const channel=this.fileChannels.get(number);
        if(!channel)throw new BasicError('FILE NOT OPEN');
        if(channel.mode==='OUTPUT'){
          const text=channel.chunks.join('')+channel.pending;
          if(channel.printer){
            const job={device:'LP1',name:this.programName,created:this.programCreated,text};
            if(this.hooks.linePrinter)this.hooks.linePrinter(job);
            else this.print(text);
          }else this.fileWrite(channel.path,text);
        }
        this.fileChannels.delete(number);
      }
    }
    async execute(statement,ctx) {
      const src=statement.trim();if(!src)return;
      if(/^REM/i.test(src)||src.startsWith("'"))return;
      const m=src.match(/^([A-Za-z]+\$?|\?)(?=\W|$)\s*(.*)$/s);
      const cmd=m?upper(m[1]):'';let rest=m?m[2]:src;
      if(cmd==='LINPUT'){await this.lineInput(rest);return;}
      if(cmd==='KILL'){this.killFile(rest);return;}
      if(cmd==='OPEN'){this.openFile(rest);return;}
      if(cmd==='CLOSE'){this.closeFiles(rest);return;}
      if(cmd==='PRINT'&&/^#/.test(rest)){this.printFile(rest);return;}
      if(cmd==='PRINT'||cmd==='?'){this.printStatement(rest);return;}
      if(cmd==='DEF'){if(ctx.interactive)throw new BasicError('ILLEGAL DIRECT');this.defineFunction(rest);return;}
      if(cmd==='LET'||this.findEquals(src)>=0 && !/^(IF|FOR|DEF|ON|DATA)\b/i.test(src)){
        const assign=cmd==='LET'?rest:src,idx=this.findEquals(assign);if(idx<0)throw new BasicError('SYNTAX ERROR');
        this.assign(assign.slice(0,idx),this.evaluate(assign.slice(idx+1)));return;
      }
      if(cmd==='IF'&&/^END\s*#/.test(rest)){
        const match=rest.match(/^END\s*#\s*(.+?)\s+THEN\s+(.+)$/i);
        if(!match)throw new BasicError('SYNTAX ERROR');
        const channel=this.fileChannel(match[1],'INPUT');
        if(!channel.values.length&&channel.index>=channel.lines.length){
          const branch=match[2].trim();
          if(/^\d+$/.test(branch))this.jumpTo(ctx,Number(branch));
          else for(const piece of splitStatements(branch))await this.execute(piece,ctx);
        }
        return;
      }
      if(cmd==='IF'){
        const branch=this.parseIfStatement(rest,ctx);if(!branch)return;
        if(/^\d+$/.test(branch)){this.jumpTo(ctx,Number(branch));return;}
        for(const piece of splitStatements(branch)){await this.execute(piece,ctx);if(ctx.jump!==null||ctx.stopped)break;}
        return;
      }
      if(cmd==='GOTO'||cmd==='GO'&&/^TO\s/i.test(rest)){this.jumpTo(ctx,this.evaluate(rest.replace(/^TO\s+/i,'')));return;}
      if(cmd==='GOSUB'){if(ctx.interactive)throw new BasicError('ILLEGAL DIRECT');ctx.callStack.push(ctx.pc+1);this.jumpTo(ctx,this.evaluate(rest));return;}
      if(cmd==='RETURN'){if(!ctx.callStack?.length)throw new BasicError('RETURN WITHOUT GOSUB');ctx.jump=ctx.callStack.pop();return;}
      if(cmd==='FOR'){
        if(ctx.interactive)throw new BasicError('ILLEGAL DIRECT');
        const eq=this.findEquals(rest);if(eq<0)throw new BasicError('SYNTAX ERROR');
        const name=upper(rest.slice(0,eq).trim());if(!/^[A-Z_][A-Z0-9_]*%?$/.test(name))throw new BasicError('SYNTAX ERROR');
        const tail=rest.slice(eq+1);const atTo=positionOfWord(tail,'TO');if(atTo<0)throw new BasicError('FOR WITHOUT TO');
        const atStep=positionOfWord(tail,'STEP',atTo+2);
        const begin=this.number(this.evaluate(tail.slice(0,atTo))),end=this.number(this.evaluate(tail.slice(atTo+2,atStep<0?undefined:atStep)));
        const step=atStep<0?1:this.number(this.evaluate(tail.slice(atStep+4)));
        if(step===0)throw new BasicError('ILLEGAL FUNCTION CALL');this.setVar(name,begin);
        const exit=(step>0?begin>end:begin<end);
        // Check FOR/NEXT pairing even when the loop executes at least once.
        const next=this.findMatchingNext(ctx.compiled.instructions,ctx.pc);
        if(exit){ctx.jump=next+1;return;}
        ctx.loops.push({name,end,step,body:ctx.pc+1});return;
      }
      if(cmd==='NEXT'){
        const name=upper(rest.trim());if(!ctx.loops.length)throw new BasicError('NEXT WITHOUT FOR');
        const idx=name?ctx.loops.findLastIndex(x=>x.name===name):ctx.loops.length-1;
        if(idx<0)throw new BasicError('NEXT WITHOUT FOR');
        const loop=ctx.loops[idx];const current=this.number(this.getVar(loop.name))+loop.step;this.setVar(loop.name,current);
        if(loop.step>0?current<=loop.end:current>=loop.end)ctx.jump=loop.body;
        else ctx.loops.splice(idx,1);
        return;
      }
      if(cmd==='DIM'){
        for(const spec of splitOutside(rest,',')){
          const match=spec.trim().match(/^([A-Za-z_][A-Za-z0-9_]*[$%¤]?)\s*\((.*)\)$/);
          if(!match)throw new BasicError('SYNTAX ERROR');const name=upper(match[1]).replace(/¤$/, '$');
          if(this.arrays.has(name))throw new BasicError('REDIMENSIONED ARRAY');
          const dims=splitOutside(match[2],',').map(v=>Math.trunc(this.number(this.evaluate(v))));
          if(dims.some(n=>n<0||n>50000)||dims.length>4)throw new BasicError('BAD SUBSCRIPT');
          this.arrays.set(name,{dims,values:new Map()});
        }return;
      }
      if(cmd==='DATA')return;
      if(cmd==='READ'){
        for(const target of splitOutside(rest,',')){
          const item=ctx.compiled.data[ctx.dataIndex++];if(!item)throw new BasicError('OUT OF DATA');
          const t=this.parseTarget(target);const value=t.name.endsWith('$')?item.value:Number(item.value);
          if(!t.name.endsWith('$')&&!Number.isFinite(value))throw new BasicError('TYPE MISMATCH');
          this.assign(target,value);
        }return;
      }
      if(cmd==='RESTORE'&&/^#/.test(rest)){
        const channel=this.fileChannel(rest.replace(/^#\s*/,''),'INPUT');
        channel.index=0;channel.values=[];return;
      }
      if(cmd==='RESTORE'){const line=rest.trim()?this.number(this.evaluate(rest)):null;ctx.dataIndex=line===null?0:((i)=>i<0?ctx.compiled.data.length:i)(ctx.compiled.data.findIndex(x=>x.line>=line));return;}
      if(cmd==='ON'){
        const match=rest.match(/^(.*?)\s+(GOTO|GO\s+TO|GOSUB)\s+(.+)$/i);if(!match)throw new BasicError('SYNTAX ERROR');
        const index=Math.trunc(this.number(this.evaluate(match[1])));const targets=splitOutside(match[3],',');
        if(index>=1&&index<=targets.length){if(upper(match[2])==='GOSUB')ctx.callStack.push(ctx.pc+1);this.jumpTo(ctx,this.evaluate(targets[index-1]));}return;
      }
      if(cmd==='INPUT'&&/^#/.test(rest)){this.inputFile(rest);return;}
      if(cmd==='INPUT'){
        const pieces=splitOutside(rest,';');let prompt='? ';
        if(pieces.length>1&&/^\s*"/.test(pieces[0])){prompt=String(this.evaluate(pieces.shift()))+'? ';rest=pieces.join(';');}
        else {const comma=splitOutside(rest,',');if(comma.length>1&&/^\s*"/.test(comma[0])){prompt=String(this.evaluate(comma.shift()))+'? ';rest=comma.join(',');}}
        const targets=splitOutside(rest,',');
        if(targets.some(t=>!t.trim()))throw new BasicError('SYNTAX ERROR');
        // PRINT ending in ; or , keeps output pending. Show it before INPUT.
        // Do not add a newline: BASIC prints the INPUT prompt on the same line.
        if(this.outputBuffer){this.print(this.outputBuffer);this.outputBuffer='';}
        let assigned = 0;
        while (assigned < targets.length) {
          const reply = await this.hooks.input(prompt);
          if(this.cancel)throw new BasicError('BREAK');
          const values = parseInputValues(reply);
          if (values.length > targets.length - assigned) throw new BasicError('REDO FROM START');
          for (const value of values) {
            const target = targets[assigned++], t = this.parseTarget(target);
            const val = t.name.endsWith('$') ? value : Number(value);
            if (!t.name.endsWith('$') && !Number.isFinite(val)) throw new BasicError('TYPE MISMATCH');
            this.assign(target, val);
          }
        }
        return;
      }
      if(cmd==='END'){ctx.stopped=true;return;}
      if(cmd==='STOP'){
        ctx.stopped=true;
        if(!ctx.interactive)this.print('STOP AT LINE '+ctx.compiled.instructions[ctx.pc].line+'\n');
        return;
      }
      if(cmd==='CLS'||cmd==='HOME'){this.hooks.clear();return;}
      if(cmd==='RANDOMIZE'){this.randomSeed=(Date.now()^(Math.random()*4294967296))>>>0;return;}
      if(cmd==='BEEP'){this.print('\u0007');return;}
      throw new BasicError('SYNTAX ERROR');
    }
    findMatchingNext(instructions,pc){let depth=0;for(let i=pc+1;i<instructions.length;i++){if(/^FOR\s/i.test(instructions[i].statement))depth++;if(/^NEXT(?:\s|$)/i.test(instructions[i].statement)){if(depth===0)return i;depth--;}}throw new BasicError('FOR WITHOUT NEXT');}
    async run(rest='',showHeader=false) {
      if(this.running)throw new BasicError('PROGRAM ALREADY RUNNING');
      const compiled=this.getCompiled();this.resetState();this.cancel=false;
      const ctx={pc:0,jump:null,stopped:false,interactive:false,compiled,loops:[],callStack:[],dataIndex:0};
      if(rest.trim()){
        const arg=rest.trim();if(!/^\d+$/.test(arg))throw new BasicError('SYNTAX ERROR');
        if(!compiled.locations.has(Number(arg)))throw new BasicError('RINDA NAV ATRASTA');ctx.pc=compiled.locations.get(Number(arg));
      }
      let steps=0,currentLine=null;
      this.running=true;this.hooks.status('RUNNING');
      try {
        if(showHeader)this.print('\n'+this.listHeader()+'\n\n');
        while(ctx.pc<compiled.instructions.length&&!ctx.stopped) {
          if(this.cancel)throw new BasicError('BREAK');
          if(++steps>this.stepLimit)throw new BasicError('OUT OF TIME');
          const ins=compiled.instructions[ctx.pc];currentLine=ins.line;ctx.jump=null;
          try {await this.execute(ins.statement,ctx);} catch(err){if(err instanceof BasicError&&err.line===null)err.line=currentLine;throw err;}
          ctx.pc=ctx.jump!==null?ctx.jump:ctx.pc+1;
          if(steps%200===0)await waitTick();
        }
        this.flushOutput();
        this.print('\nREADY\n');
      } catch(err){this.flushOutput();throw err;}
      finally {
        try {if(this.fileChannels.size)this.closeFiles();}
        finally {this.running=false;this.hooks.status('READY');}
      }
    }
  }
  return { Interpreter, BasicError, splitStatements, tokenize };
});
