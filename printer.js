/* Browser print bridge for SAVE LP: / SAVE LP1:. */
'use strict';
window.PecisPrinter = {
  print(job, notify) {
    // Open a separate document synchronously during the user gesture.
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
      notify('Pārlūks nobloķēja drukas logu. Atļauj uznirstošos logus.');
      return;
    }
    const doc = w.document;
    doc.title = 'LP1 — ' + job.name;
    const css = `
      @font-face {
        font-family: "Pecis DotMatrix";
        src: url("https://cdn.jsdelivr.net/gh/Gissio/font_DotMatrix@main/fonts/webfonts/DotMatrix-Regular.woff2") format("woff2");
        font-style: normal; font-weight: 400; font-display: swap;
      }
      @page { size: A4 portrait; margin: 16mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #d8d4c9; color: #25241d; }
      .paper {
        width: min(210mm, 100%); min-height: 297mm;
        margin: 16px auto; padding: 19mm 18mm 19mm 22mm;
        background: #f6f1e5; box-shadow: 0 8px 32px #0003;
        position: relative;
      }
      .paper::before, .paper::after {
        content: ""; position: absolute; top: 0; bottom: 0; width: 10mm;
        background: radial-gradient(circle, #d8d4c9 0 2mm, transparent 2.1mm)
                    center 4mm / 10mm 13mm repeat-y;
      }
      .paper::before { left: 0; }
      .paper::after { right: 0; }
      pre {
        margin: 0; white-space: pre; overflow-wrap: normal;
        font: 15px/1.55 "Pecis DotMatrix", "Courier New", monospace;
        letter-spacing: .01em; tab-size: 8;
      }
      .note { font: 12px system-ui,sans-serif; color: #5e5b54; padding: 8px 15px; text-align: center; }
      @media print {
        html, body { background: #fff; }
        .paper { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; background: #fff; }
        .paper::before, .paper::after, .note { display: none; }
        pre { font-size: 13px; line-height: 1.45; }
      }
    `;
    const style = doc.createElement('style'); style.textContent = css;
    doc.head.append(style);
    const paper = doc.createElement('main'); paper.className = 'paper';
    const pre = doc.createElement('pre'); pre.textContent = job.text;
    paper.append(pre); doc.body.append(paper);
    const note = doc.createElement('p'); note.className = 'note';
    note.textContent = 'LP1: Drukas priekšskatījums — izvēlies printeri vai Save as PDF.';
    doc.body.append(note);
    // Wait for the font to load, but do not hang forever when offline.
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, 1800); });
    const fonts = doc.fonts && doc.fonts.load
      ? doc.fonts.load('15px "Pecis DotMatrix"').catch(() => {})
      : Promise.resolve();
    Promise.race([fonts, timeout]).then(() => {
      clearTimeout(timer);
      if (!w.closed) { w.focus(); w.print(); }
    });
  }
};
