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
 console.log('ALL TESTS PASSED');
})().catch(e=>{console.error('FAIL:',e.stack);process.exit(1)});
