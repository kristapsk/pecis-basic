# Pēcis BASIC — tīmekļa terminālis

Neatkarīgs, izglītojošs retro BASIC interpretators, kuru iedvesmojusi B. Martuzāna 1986. gada grāmata **«Kā Pēcis Beisikāns Maiju Saprātiņu programmēt mācīja»**.

Grāmata: https://laacz.lv/f/txt/ka-pecis-beiskans-maiju-sapratinu-programmet-macija/

> **Savietojamības statuss:** pašlaik darbojošs klasiskā BASIC apakškopas interpretators ar lieldatora termināļa saskarni. Tas nav konkrēta vēsturiska datora CPU, ROM vai faktiskā BASIC dialekta precīzs emulators. Pilnu grāmatas skenējumu šajā izstrādes vidē neizdevās lejupielādēt un sistemātiski salīdzināt. Tāpēc komandu kopu, ekrāna formātu, kļūdu tekstus un citus sīkumus vēl nepieciešams salīdzināt ar oriģinālu.

## Palaišana

- **Lokāli:** lejupielādējiet `pecis-basic-standalone.html` (pakāpeniskais izlaidums) un atveriet jebkurā modernā pārlūkā. Nekāda instalācija nav nepieciešama.
- **Github Pages:** šī projekta mapes `index.html`, `basic.js`, `ui.js` un citus failus ievietojiet GitHub repozitorija saknē, tad Settings → Pages → Deploy from a branch → `main` → `/ (root)`.
- **Lokāls HTTP serveris (izstrādei):** `python3 -m http.server 8000` šajā direktorijā; pārlūkā `http://localhost:8000`.

## Kā lietot

Rakstiet komandas tieši terminālī:

```basic
10 PRINT "SVEIKA, MAIJA!"
20 FOR I=1 TO 5
30 PRINT I
40 NEXT I
RUN
LIST
SAVE DK1:TESTS
NEW
LOAD DK1:TESTS
RUN
```

Ar `SAVE DK1:TESTS` programmas teksts tiek saglabāts konkrētā pārlūka `localStorage`, nevis īstā disketē. Ar `SAVE LP1:` tiek izvadīts listings uz ekrāna, nevis īstu printeri. `OLD` ir alias pēdējās programmas ielādei. Programmu iespējams arī importēt/eksportēt kā `.bas` failu. Ja pārlūkprogramma neatļauj `localStorage`, tiek izmantota pagaidu atmiņa bez saglabāšanas starp pārlādes reizēm.

Tastatūra: `Enter` – komanda, `↑/↓` – komandu vēsture, `Ctrl+C` – pārtraukt, `Ctrl+Enter` – RUN, `Ctrl+L` – notīrīt ekrānu.

## Pašlaik īstenots

- Programmas rindas 1–65535, `RUN`, `RUNNH`, `LIST`, `NEW`, `CLEAR`, `CLS`, `HELP`, `RENUM`, `SAVE`, `LOAD`, `OLD`, `FILES`.
- `PRINT`, `?`, `LET`, `INPUT`, `IF…THEN…ELSE`, `GOTO`, `GOSUB`, `RETURN`, `FOR…TO…STEP`, `NEXT`, `ON…GOTO`, `ON…GOSUB`, `DIM`, `DATA`, `READ`, `RESTORE`, `STOP`, `END`, `REM`.
- Skaitliskas un virkņu vērtības, mainīgie, 1–4 dimensiju masīvi, aritmētika, salīdzināšanas un loģiskie operatori, standarta matemātiskās un virkņu funkcijas.
- Aizsardzība pret nekontrolētu izpildi (1 000 000 soļu limits; tiek uzturēts BREAK).
- Četri paraugprogrammu piemēri (tie ir oriģināli jaunveidoti piemēri, nevis pārrakstīti no grāmatas).
- Bez `eval()`, bez backend servisa un bez ārējiem JavaScript/CDN failiem.

## Zināmie ierobežojumi

- Komandu sintakse un kļūdu teksti nav vēsturiski verificēti.
- Nav `PEEK`, `POKE`, `DEF FN`, `CONT`, termināļa īpašās grafikas, faktiskas `LP1:` iekārtas vai konkrētās lieldatora operētājsistēmas.
- `RND` izmanto pārlūka pseidogadījumu skaitļu ģeneratoru, nevis vēsturisko.
- `RENUM` droši pārraksta tikai dažas nepārprotamas atsauces uz rindas numuru; sarežģītām konstrukcijām nepieciešama manuāla pārbaude.
- `SAVE DK1:` ir pārlūka virtuāls disks; saglabātās programmas netiek sinhronizētas starp ierīcēm.

## Testi

```sh
node test.js
```

## Nākamā rekonstrukcijas fāze

1. Iegūt pilnu skenējumu un izveidot grāmatā sastopamo komandu tabulu ar lappušu atsaucēm.
2. Ievadīt un automatizēti pārbaudīt grāmatas programmas.
3. Dokumentēt nesakritības, īstenot faktiskās sintakses un kļūdu atšķirības.
4. Ja ir tiesības pārpublicēt, pievienot grāmatas lappušu lasītāju blakus terminālim.

## Licence

Šis sākotnējais interpretatora kods un lietotnes dizains: MIT licence, skatīt `LICENSE`. Grāmatas teksts un skenējumi **nav** iekļauti, un to autortiesības netiek nodotas.
