const assert = require('node:assert/strict');
const {Interpreter,BasicError}=require('./basic.js');
const store=new Map();
const storage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.has(k)?store.get(k):null,key:i=>[...store.keys()][i],get length(){return store.size;}};
let output='';let answers=[];
const b=new Interpreter({print:s=>output+=s,input:async()=>answers.shift(),clear:()=>output='',storage});
async function check(name, program, match, inputs=[]) {
  b.import(program);output='';answers=inputs.slice();await b.run();assert.match(output,match);console.log('PASS',name);
}
(async()=>{
 await check('HELLO','10 PRINT "SVEIKA, MAIJA!"\n20 END',/SVEIKA, MAIJA!/);
 await check('FOR and print','10 FOR I=1 TO 3\n20 PRINT I; " ";\n30 NEXT I\n40 PRINT',/1 2 3/);
 await check('negative step','10 FOR I=3 TO 1 STEP -1\n20 PRINT I;\n30 NEXT I\n40 PRINT',/321/);
 await check('nested loops','10 FOR I=1 TO 2\n20 FOR J=1 TO 2\n30 PRINT I*10+J;",";\n40 NEXT J\n50 NEXT I\n60 PRINT',/11,12,21,22,/);
 await check('skip FOR','10 FOR I=5 TO 1\n20 PRINT "WRONG"\n30 NEXT I\n40 PRINT "RIGHT"',/RIGHT/);
 assert(!output.includes('WRONG'));
 await check('IF THEN ELSE','10 A=3\n20 IF A=3 THEN PRINT "YES": PRINT "OK" ELSE PRINT "NO"',/YES\nOK/);
 await check('GOTO','10 A=1\n20 GOTO 40\n30 PRINT "BAD"\n40 PRINT A',/1/);assert(!output.includes('BAD'));
 await check('GOSUB','10 GOSUB 50\n20 PRINT "AFTER"\n30 END\n50 PRINT "SUB"\n60 RETURN',/SUB\nAFTER/);
 await check('DIM DATA READ','10 DIM A(2)\n20 DATA 4,5\n30 READ A(1),A(2)\n40 PRINT A(1)+A(2)',/9/);
 await check('INPUT','10 INPUT "VECUMS";N\n20 PRINT N+1',/43/,['42']);
 await check('string funcs','10 A$="MAIJA"\n20 PRINT LEFT$(A$,2);RIGHT$(A$,2)',/MAJA/);
 await check('ON GOTO','10 N=2\n20 ON N GOTO 40,50\n30 PRINT "BAD"\n40 PRINT "ONE":END\n50 PRINT "TWO":END',/TWO/);assert(!output.includes('BAD'));
 await check('RESTORE','10 DATA 1,2\n20 READ A\n30 RESTORE\n40 READ B\n50 PRINT A+B',/2/);
 await b.command('SAVE DK1:TEST'); await b.command('NEW');await b.command('LOAD DK1:TEST');assert.match(b.list(),/10 DATA/);console.log('PASS local disk SAVE/LOAD');
 await b.command('RENUM 100,5');assert.match(b.list(),/^100 DATA/m);console.log('PASS RENUM');
 await b.command('PRINT 2^3^2');assert.match(output,/512/);console.log('PASS arithmetic');
 await check('six digits: large exponent', '10 A=12\n20 PRINT A^A', /8\.91610E\+12/);
 await check('six digits: ordinary integer', '10 PRINT 12^2', /144\n/);
 await check('six digits: fraction', '10 PRINT 1/3', /0\.333333\n/);
 await check('six digits: large threshold', '10 PRINT 1000000', /1\.00000E\+6/);
 await check('six digits: STR$', '10 PRINT STR$(12^12)', /8\.91610E\+12/);
 await b.command('NEW');
 await b.command('10A=12');
 await b.command('20B=20');
 await b.command('30 PRINT A+B');
 assert.match(b.list(),/^10 A=12\n20 B=20\n30 PRINT A\+B$/);
 await b.run();assert.match(output,/32/);
 await b.command('20');assert.doesNotMatch(b.list(),/^20 /m);
 console.log('PASS numbered lines without spaces and deletion');
 // LIST header has the current program's name and its original creation time.
 await b.command('NEW');
 await b.command('10A=12');
 b.programCreated='1986-11-21T14:35:20.000Z';
 await b.command('SAVE DK1:SUPER');
 output='';await b.command('LIST');
 assert.match(output,/SUPER\s+\d\d-[A-Z]{3}-86\s+\d\d:\d\d:\d\d\n\n10 A=12/);
 await b.command('NEW');
 await b.command('LOAD DK1:SUPER');
 assert.equal(b.programCreated,'1986-11-21T14:35:20.000Z');
 assert.equal(b.list(),'10 A=12');
 console.log('PASS LIST header and persisted creation time');
 // NEW with a name must update the LIST header without printing a message.
 output='';
 await b.command('NEW SUPER');
 assert.equal(output,'');
 assert.equal(b.programName,'SUPER');
 await b.command('10A=12');
 await b.command('20B=20');
 output='';
 await b.command('LIST');
 assert.match(output,/^\nSUPER\s+\d\d-[A-Z]{3}-\d\d\s+\d\d:\d\d:\d\d\n\n10 A=12\n20 B=20\n$/);
 output='';
 await b.command('NEW');
 assert.equal(output,'');
 assert.equal(b.programName,'PROGRAMMA');
 // RUN shows the same program header as LIST; RUNNH does not.
 await b.command('NEW SUPER');
 await b.command('10 PRINT "RESULT=32"');
 b.programCreated='1986-11-21T14:46:30.000Z';
 output='';
 await b.command('RUN');
 assert.match(output,/^\nSUPER\s+\d\d-[A-Z]{3}-86\s+\d\d:\d\d:\d\d\n\nRESULT=32\n/);
 assert.match(output,/READY\n$/);
 output='';
 await b.command('RUNNH');
 assert.doesNotMatch(output,/SUPER|21-NOV-86/);
 assert.match(output,/^RESULT=32\n\nREADY\n$/);
 output='';
 await b.command('RUN 10');
 assert.match(output,/^\nSUPER\s+/);
 // Both printer aliases dispatch a print job, not a disk SAVE.
 await b.command('NEW SUPER');
 await b.command('10 PRINT "HELLO"');
 const printJobs=[];
 b.hooks.linePrinter=job=>printJobs.push(job);
 output='';
 await b.command('SAVE LP:');
 await b.command('SAVE LP1:');
 assert.equal(printJobs.length,2);
 for(const job of printJobs){
   assert.equal(job.device,'LP1');
   assert.equal(job.name,'SUPER');
   assert.match(job.text,/SUPER[\s\S]*10 PRINT "HELLO"/);
 }
 assert.equal(output,'');
 assert.equal(storage.getItem('pecis.basic.file.LP'),null);
 assert.equal(storage.getItem('pecis.basic.file.LP1'),null);
 b.hooks.linePrinter=null;
 console.log('PASS SAVE LP:/LP1: printer dispatch');
 // BYE and EXIT delegate shutdown to the embedding environment.
 const exits=[];
 b.hooks.exit=()=>exits.push('exit');
 output='';
 await b.command('BYE');
 await b.command('EXIT');
 assert.deepEqual(exits,['exit','exit']);
 assert.equal(output,'');
 console.log('PASS BYE/EXIT host shutdown callback');
 // LISTNH must omit the program header while preserving line ranges.
 await b.command('NEW SUPER');
 await b.command('110 PRINT "ONE"');
 await b.command('120 GOTO 140');
 await b.command('130 PRINT "SKIP"');
 await b.command('140 END');
 output='';await b.command('LISTNH 110-120');
 assert.equal(output,'110 PRINT "ONE"\n120 GOTO 140\n');
 output='';await b.command('LIST');
 assert.match(output,/SUPER\s+\d\d-[A-Z]{3}-\d\d/);
 // RESEQ without parameters renumbers lines and their references silently.
 output='';await b.command('RESEQ');
 assert.equal(output,'');
 assert.equal(b.list(),'10 PRINT "ONE"\n20 GOTO 40\n30 PRINT "SKIP"\n40 END');
 // RESEQ accepts BASIC-11's start, old-line range, and increment.
 await b.command('NEW RANGE');
 await b.command('10 PRINT "KEEP"');
 await b.command('110 GOTO 120');
 await b.command('120 PRINT "MOVED"');
 await b.command('130 END');
 await b.command('RESEQ 20,110-130,20');
 assert.equal(b.list(),'10 PRINT "KEEP"\n20 GOTO 40\n40 PRINT "MOVED"\n60 END');
 await b.command('RESEQ 20-60,10');
 assert.equal(b.list(),'10 PRINT "KEEP"\n20 GOTO 30\n30 PRINT "MOVED"\n40 END');
 await assert.rejects(b.command('RESEQ 10,30-40,10'),/LINE NUMBER CONFLICT/);
 console.log('PASS LISTNH and RESEQ');
 // BASIC-11 diagnostics come directly from the interpreter in English.
 await b.command('NEW ERRORS');
 await b.command('30 PRONT A');
 await assert.rejects(b.command('RUNNH'), e=>e instanceof BasicError && e.message==='SYNTAX ERROR' && e.line===30);
 await b.command('NEW LOOPS');
 await b.command('60 FOR I=1 TO 3');
 await b.command('70 PRINT I');
 await assert.rejects(b.command('RUNNH'), e=>e instanceof BasicError && e.message==='FOR WITHOUT NEXT' && e.line===60);
 await b.command('NEW STOPTEST');
 await b.command('100 PRINT "BEFORE"');
 await b.command('110 STOP');
 await b.command('120 PRINT "AFTER"');
 output='';await b.command('RUNNH');
 assert.match(output,/BEFORE\nSTOP AT LINE 110\n/);
 assert.doesNotMatch(output,/AFTER/);
 await b.command('110 END');
 output='';await b.command('RUNNH');
 assert.doesNotMatch(output,/STOP AT LINE/);
 await b.command('NEW MATH');
 await b.command('10 PRINT 1/0');
 await assert.rejects(b.command('RUNNH'),e=>e instanceof BasicError && e.message==='DIVISION BY ZERO' && e.line===10);
 console.log('PASS BASIC-11 English errors and STOP');
 // Backslash is a BASIC-11 statement separator, even with empty fields.
 await check('backslash: statement and REM',
   '10 M=70 \\ \\ REM MINIMUM SALARY\n20 A=M+2 \\ PRINT A\n30 END', /72/);
 assert.match(b.list(),/10 M=70 \\/);
 await check('backslash: multiple statements',
   '10 A=1 \\ B=2 \\ C=A+B\n20 PRINT C', /3/);
 await check('backslash: quoted string',
   '10 PRINT "A\\B" \\ PRINT "OK"', /A\\B\nOK/);
 await check('backslash: IF branch',
   '10 A=1\n20 IF A=1 THEN PRINT "YES" \\ PRINT "OK"\n30 END', /YES\nOK/);
 console.log('PASS BASIC-11 backslash statement separators');
 // Pending PRINT output must be visible before INPUT requests a value.
 await b.command('NEW INPUTORDER');
 await b.command('10 PRINT "IEVADIET A"; \\ INPUT A');
 await b.command('20 PRINT "IEVADIET B"; \\ INPUT B');
 await b.command('30 PRINT A+B');
 const previousInput=b.hooks.input, seen=[];
 answers=['12','20']; output='';
 b.hooks.input=async question=>{seen.push({question,output});return answers.shift();};
 try { await b.command('RUNNH'); }
 finally { b.hooks.input=previousInput; }
 assert.deepEqual(seen.map(x=>x.output),['IEVADIET A','IEVADIET AIEVADIET B']);
 assert.deepEqual(seen.map(x=>x.question),['? ','? ']);
 assert.match(output,/32\n/);
 console.log('PASS pending PRINT output before INPUT');
 // RND is a zero-argument function even without parentheses.
 await b.command('NEW RANDOM');
 await b.command('10 A=RND');
 await b.command('20 B=RND()');
 await b.command('30 C=RND(1)');
 await b.command('40 PRINT A,B,C');
 output='';await b.command('RUNNH');
 for(const name of ['A','B','C']) {
   assert(b.getVar(name)>=0 && b.getVar(name)<1, name+' must be random');
 }
 const first=b.getVar('A');
 output='';await b.command('RUNNH');
 assert.notEqual(b.getVar('A'),first);
 console.log('PASS bare RND and parenthesized RND');
 // ON accepts the BASIC-11 GO TO spelling, including computed branches.
 await check('ON GO TO branch 2',
   '10 R=2\n20 ON R GO TO 40,60,80\n30 PRINT "BAD":END\n40 PRINT "FIRST":END\n60 PRINT "SECOND":END\n80 PRINT "THIRD":END', /SECOND/);
 assert.doesNotMatch(output,/FIRST|THIRD|BAD/);
 await check('ON GO TO branch 1',
   '10 R=1\n20 ON R GO TO 40,60\n30 PRINT "BAD":END\n40 PRINT "FIRST":END\n60 PRINT "SECOND":END', /FIRST/);
 assert.doesNotMatch(output,/SECOND|BAD/);
 await check('ON GOTO remains supported',
   '10 R=2\n20 ON R GOTO 40,60\n30 END\n40 PRINT "BAD":END\n60 PRINT "OK":END', /OK/);
 // Both renumbering commands must fix ON GO TO and ordinary GO TO references.
 await b.command('NEW TARGETS');
 await b.command('10 ON R GO TO 50,80');
 await b.command('20 GO TO 80');
 await b.command('50 PRINT "ONE"');
 await b.command('80 END');
 await b.command('RENUM 100,10');
 assert.match(b.list(),/^100 ON R GO TO 120,130$/m);
 assert.match(b.list(),/^110 GO TO 130$/m);
 await b.command('RESEQ 10');
 assert.match(b.list(),/^10 ON R GO TO 30,40$/m);
 assert.match(b.list(),/^20 GO TO 40$/m);
 console.log('PASS ON GO TO, RENUM and RESEQ targets');
  // BASIC-11 accepts REM without whitespace, including comments after backslashes.
  await check('REM without space after separator',
    '10 A=7 \\ REM1111\n20 PRINT A', /7/);
  await check('REM without space at line start',
    '10 REM4444444444\n20 PRINT "OK"', /OK/);
  await check('REM consumes rest of statement line',
    '10 PRINT "BEFORE" \\ REM123 \\ PRINT "AFTER"\n20 END', /BEFORE/);
  assert.doesNotMatch(output,/AFTER/);
  await check('REM with normal space still works',
    '10 REM COMMENT\n20 PRINT "STILL OK"', /STILL OK/);
  console.log('PASS BASIC-11 REM without whitespace');
 // BASIC-11: ¤ and $ are equivalent string variable suffixes.
 await b.command('NEW CURRENCY');
 await b.command('10 A¤="A"');
 await b.command('20 PRINT A¤;A$');
 await b.command('30 A$="B"');
 await b.command('40 PRINT A¤');
 output='';await b.command('RUNNH');
 assert.match(output,/AA\nB\n/);
 assert.equal(b.getVar('A$'),'B');
 assert.match(b.list(),/10 A¤="A"/);
 await b.command('NEW CURRENCYARRAY');
 await b.command('10 DIM B¤(2)');
 await b.command('20 B¤(1)="YES"');
 await b.command('30 PRINT B$(1)');
 output='';await b.command('RUNNH');
 assert.match(output,/YES\n/);
 await b.command('NEW CURRENCYINPUT');
 await b.command('10 INPUT S¤');
 await b.command('20 PRINT S$');
 answers=['HELLO'];output='';await b.command('RUNNH');
 assert.match(output,/HELLO\n/);
  // The book uses «...» for string literals; LIST preserves that spelling.
  await check('guillemets: book example',
    '10 PRINT «PROGRAMMA SAKAHRTO 2 VAHRDUS PEHC ALFABEHTA»\n20 PRINT «IEVADIET DIVUS VAHRDUS»\n30 INPUT S1¤, S2¤\n40 IF S1¤>S2¤ THEN 60\n50 PRINT S1¤, S2¤\n60 PRINT S2¤, S1¤\n70 STOP\n80 END',
    /PROGRAMMA SAKAHRTO 2 VAHRDUS PEHC ALFABEHTA/, ['A,B']);
  assert.match(output,/IEVADIET DIVUS VAHRDUS/);
  assert.match(b.list(),/10 PRINT «PROGRAMMA SAKAHRTO/);
  await check('guillemets: separators within literal',
    '10 PRINT «A;B,C:D\\E» \\ PRINT "OK"', /A;B,C:D\\E\nOK/);
  await check('guillemets: assignment, comparison and mixed quotes',
    '10 A¤=«A»\n20 B$="A"\n30 IF A¤=B$ THEN PRINT «MATCH"ED»', /MATCH"ED/);
  await check('guillemets: literal signs inside ASCII quotes',
    '10 PRINT "«not a delimiter»"', /«not a delimiter»/);
  console.log('PASS BASIC-11 guillemet string literals');
 // INPUT accepts one or several comma-separated fields per reply, and prompts
 // again for any remaining variables.
 await check('INPUT: separate replies',
   '10 INPUT S1¤,S2¤\n20 PRINT S1¤;"/";S2¤', /ANNA\/ZUZANNA/,
   ['ANNA','ZUZANNA']);
 await check('INPUT: comma-separated reply',
   '10 INPUT S1¤,S2¤\n20 PRINT S1¤;"/";S2¤', /ANNA\/ZUZANNA/,
   ['ANNA,ZUZANNA']);
 await check('INPUT: quoted comma and escaped quote',
   '10 INPUT S1¤,S2¤\n20 PRINT S1¤;"/";S2¤', /RIGA, LATVIJA\/ZUZANNA/,
   ['"RIGA, LATVIJA",ZUZANNA']);
 await check('INPUT: three variables across replies',
   '10 INPUT A$,B$,C$\n20 PRINT A$;"/";B$;"/";C$', /FIRST\/SECOND\/THIRD/,
   ['FIRST,SECOND','THIRD']);
 await check('INPUT: doubled quotes in a field',
   '10 INPUT A$\n20 PRINT A$', /SAYS "HELLO"/,
   ['"SAYS ""HELLO"""']);
 await b.command('NEW INPUTBAD');
 await b.command('10 INPUT A$,B$');
 answers=['"UNTERMINATED'];
 await assert.rejects(b.command('RUNNH'),e=>e instanceof BasicError&&e.message==='REDO FROM START'&&e.line===10);
 answers=['A,B,C'];
 await assert.rejects(b.command('RUNNH'),e=>e instanceof BasicError&&e.message==='REDO FROM START'&&e.line===10);
 console.log('PASS BASIC-11 INPUT comma and multi-reply parsing');
 console.log('PASS BASIC-11 currency-sign string variable suffix');
 console.log('ALL TESTS PASSED');
})().catch(e=>{console.error('FAIL:',e.stack);process.exit(1)});
