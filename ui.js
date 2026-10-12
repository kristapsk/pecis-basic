'use strict';
(function(){
const $=id=>document.getElementById(id);
const output=$('output'), input=$('command'), prompt=$('prompt'), form=$('cmdForm');
const localMemory=new Map();
const memoryStore={getItem:k=>localMemory.has(k)?localMemory.get(k):null,setItem:(k,v)=>localMemory.set(k,String(v)),key:i=>[...localMemory.keys()][i],get length(){return localMemory.size;}};
let storage=memoryStore;try{localStorage.setItem('pecis.basic.storage-check','yes');localStorage.removeItem('pecis.basic.storage-check');storage=localStorage;}catch(_){}
let history=[], historyPosition=0, inputResolver=null, busy=false;
let pending='', toastTimer=null;
// KOI-7 N2 (short KOI): ASCII 0x60-0x7E displays uppercase Cyrillic.
// This is a display-layer emulation; BASIC program data stays unchanged.
const shortKoi='ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧ';
let charset=storage.getItem('pecis.basic.charset')==='modern'?'modern':'koi7';
function displayText(value){
 const text=String(value);
 return charset==='koi7'?text.replace(/[\x60-\x7e]/g,ch=>shortKoi[ch.charCodeAt(0)-0x60]):text;
}
function terminalInput(value){
 return charset==='koi7'?String(value).replace(/[a-z]/g,ch=>ch.toUpperCase()):String(value);
}

const examples={
  hello:`10 REM SVEIKA, MAIJA!\n20 PRINT "LABDIEN, MAIJA!"\n30 PRINT "TE RUNA PECIS BEISKANS."\n40 PRINT "MES MACAMIES PROGRAMMET!"\n50 END`,
  loop:`10 REM SKAITISIM KOPA\n20 PRINT "KAPINOS LIDZ 10:"\n30 FOR I=1 TO 10\n40 PRINT I; " ";\n50 NEXT I\n60 PRINT\n70 PRINT "TAGAD ATPAKAL:"\n80 FOR I=10 TO 1 STEP -1\n90 PRINT I; " ";\n100 NEXT I\n110 PRINT`,
  guess:`10 REM UZMINI SKAITLI\n20 N=INT(RND(1)*10)+1\n30 PRINT "ES IEDOMAJOS SKAITLI NO 1 LIDZ 10."\n40 INPUT "TAVS MINEJUMS"; A\n50 IF A<N THEN PRINT "PAR MAZU!":GOTO 40\n60 IF A>N THEN PRINT "PAR LIELU!":GOTO 40\n70 PRINT "PAREIZI! APSVEICU!"\n80 END`,
  data:`10 REM DATU TABULA\n20 DIM A(5)\n30 DATA 2,4,6,8,10\n40 FOR I=1 TO 5\n50 READ A(I)\n60 NEXT I\n70 PRINT "N"; TAB(12); "N KVADRATA"\n80 FOR I=1 TO 5\n90 PRINT A(I); TAB(12); A(I)*A(I)\n100 NEXT I\n110 END`,
  temperature:`10 REM TEMPERATURAS PARREKINS
20 PRINT "TEMPERATURAS PARREKINS"
30 PRINT "1 - CELSIJS UZ FARENHEITU"
40 PRINT "2 - FARENHEITS UZ CELSIJU"
50 INPUT "IZVELIES 1 VAI 2"; N
60 IF N=1 THEN GOTO 100
70 IF N=2 THEN GOTO 200
80 PRINT "NEPAREIZA IZVELE": GOTO 50
100 INPUT "GRADI CELSIJA SKALA"; C
110 F=C*9/5+32
120 PRINT C; " C = "; F; " F"
130 END
200 INPUT "GRADI FARENHEITA SKALA"; F
210 C=(F-32)*5/9
220 PRINT F; " F = "; C; " C"
230 END`
};
function add(text, className=''){
  if(!text)return;
  let node=document.createElement('span');node.className=className;node.dataset.raw=text;
  node.textContent=(className==='soft'||className==='err')?text:displayText(text);output.append(node);
  output.scrollTop=output.scrollHeight;
  // Retain a bounded scrollback to avoid unbounded browser memory use.
  while(output.childNodes.length>1500)output.firstChild.remove();
}
function clear(){output.textContent='';}
function setStatus(state){$('statusLabel').textContent=state==='RUNNING'?'IZPILDE':state;}
function toast(text){const t=$('toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600);}
const basic=new PecisBasic.Interpreter({print:s=>add(s),clear,status:setStatus,storage,
  input: (question)=>new Promise(resolve=>{inputResolver=resolve;prompt.textContent=question;form.classList.add('input-pending');input.placeholder='ievadi atbildi';input.focus();})});
function finishInput(){inputResolver=null;prompt.textContent='READY >';form.classList.remove('input-pending');input.placeholder='raksti komandu un spied ENTER';}
function showError(err){add((err instanceof PecisBasic.BasicError?'? ':'! ')+(err.message||String(err))+(err.line!==null&&err.line!==undefined?' RINDĀ '+err.line:'')+'\n','err');}
async function command(text, echo=true){
 if(inputResolver){let resolve=inputResolver;add(prompt.textContent+text+'\n','old-input');finishInput();resolve(text);return;}
 if(busy){toast('PROGRAMMA TIEK IZPILDĪTA — Nospied BREAK');return;}
 if(!text.trim())return;
 if(echo)add('> '+text+'\n','old-input');
 history.push(text);if(history.length>100)history.shift();historyPosition=history.length;
 busy=true;try{await basic.command(text);}catch(err){showError(err);}finally{busy=false;input.focus();}
}
form.addEventListener('submit',ev=>{ev.preventDefault();const text=terminalInput(input.value);input.value='';command(text);});
// A historical keyboard provides capital Latin letters for BASIC entry.
input.addEventListener('input',()=>{if(charset==='koi7')input.value=terminalInput(input.value);});
input.addEventListener('keydown',ev=>{
 if(ev.key==='ArrowUp'&&!inputResolver){ev.preventDefault();if(historyPosition>0)historyPosition--;input.value=history[historyPosition]||'';}
 if(ev.key==='ArrowDown'&&!inputResolver){ev.preventDefault();historyPosition=Math.min(history.length,historyPosition+1);input.value=history[historyPosition]||'';}
});
document.addEventListener('keydown',ev=>{
 if(ev.ctrlKey&&(ev.key==='c'||ev.key==='C')&&!window.getSelection()?.toString()){ev.preventDefault();interrupt();}
 if(ev.ctrlKey&&ev.key==='Enter'){ev.preventDefault();if(!busy)command('RUN');}
 if(ev.ctrlKey&&(ev.key==='l'||ev.key==='L')){ev.preventDefault();clear();input.focus();}
});
function interrupt(){basic.stop();if(inputResolver){const resolve=inputResolver;finishInput();resolve('');}if(!busy){add('BREAK\n','soft');setStatus('READY');}input.focus();}
$('runBtn').onclick=()=>command('RUN');
$('listBtn').onclick=()=>command('LIST');
$('newBtn').onclick=()=>{if(basic.lines.size&&!confirm('Dzēst visu programmu no atmiņas?'))return;command('NEW');};
$('breakBtn').onclick=interrupt;
$('phosphor').onchange=e=>{document.body.classList.toggle('amber',e.target.value==='amber');storage.setItem('pecis.basic.phosphor',e.target.value);input.focus();};
if(storage.getItem('pecis.basic.phosphor')==='amber'){$('phosphor').value='amber';document.body.classList.add('amber');}
$('charset').value=charset;
$('charset').onchange=e=>{
 charset=e.target.value;
 storage.setItem('pecis.basic.charset',charset);
 output.querySelectorAll('[data-raw]').forEach(node=>{node.textContent=(node.classList.contains('soft')||node.classList.contains('err'))?node.dataset.raw:displayText(node.dataset.raw);});
 if(charset==='koi7')input.value=terminalInput(input.value);
 input.focus();
};
function showEditor(){const el=$('editor');el.classList.add('visible');$('source').value=basic.list();$('source').focus();}
$('editBtn').onclick=()=>{$('editor').classList.contains('visible')?$('editor').classList.remove('visible'):showEditor();};
$('closeEditorBtn').onclick=()=>{$('editor').classList.remove('visible');input.focus();};
function applyEditor(){if(busy){toast('VISPIRMS PĀRTRAUC IZPILDI');return false;}try{basic.import($('source').value);add('> PROGRAMMA IELĀDĒTA NO REDAKTORA\n','soft');toast('PROGRAMMA IELĀDĒTA');return true;}catch(err){showError(err);return false;}}
$('applyBtn').onclick=()=>{if(applyEditor())input.focus();};
$('applyRunBtn').onclick=()=>{if(applyEditor()){$('editor').classList.remove('visible');command('RUN');}};
$('exportBtn').onclick=()=>{const body=basic.list();if(!body){toast('ATMIŅĀ NAV PROGRAMMAS');return;}const blob=new Blob([body+'\n'],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='PECIS.BAS';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('importBtn').onclick=()=>$('fileInput').click();
$('fileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(busy){toast('PĀRTRAUC PROGRAMMU PIRMS IELĀDES');return;}try{basic.import(await file.text());add('IELĀDĒTS '+file.name+'\n','soft');toast('PROGRAMMA IELĀDĒTA');}catch(err){showError(err);}finally{e.target.value='';input.focus();}};
document.querySelectorAll('[data-example]').forEach(btn=>btn.addEventListener('click',()=>{
 if(busy){toast('PĀRTRAUC PROGRAMMU PIRMS IELĀDES');return;}
 if(basic.lines.size&&!confirm('Aizstāt pašreizējo programmu ar piemēru?'))return;
 basic.import(examples[btn.dataset.example]);add('> IELĀDĒTS PIEMĒRS: '+btn.querySelector('.lesson-title').textContent+'\n','soft');
 add(basic.list()+'\n');toast('SPIED RUN, LAI PALAISTU');input.focus();
}));
add('PĒCIS BASIC — MĀCĪBU DATORA TERMINĀLIS\n','banner');
add('LATVIJA 1986 / INTERAKTĪVA REKONSTRUKCIJA\n','soft');
add('--------------------------------------------\n','soft');
add('OPERATĪVĀ ATMIŅA: GATAVA\nDISKS DK1: GATAVS     PRINTERIS LP1: GATAVS\n\n');
add('IERAKSTI HELP, LAI REDZĒTU KOMANDAS.\n','soft');
add('VAI IZVĒLIES PROGRAMMU KREISAJĀ PUSĒ.\n\n','soft');
add('READY\n','banner');
input.focus();
})();
