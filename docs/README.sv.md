# AURORA INTEL — användarhandbok

Aurora Intel är en lokal underrättelseliggare för strukturerade 7S-observationer. Tabellen, kartan, sökningen, exporter och AI-funktionerna körs på den egna datorn. Ingen inloggning eller internetanslutning används. Appen lyssnar endast på `127.0.0.1`, vilket betyder ”den här datorn”.

AI:n ger utkast. En officer måste alltid kontrollera varje fält, bedömning och fråga. Aurora hittar inte automatiskt sanningen i en rapport och ersätter inte order, källkritik, säkerhetsskydd eller ordinarie rapporterings-/larmvägar.

## USB-flöde på en frånkopplad dator

Du ska ha fått filen `aurora-intel-vX.Y.Z-offline.zip` från en betrodd releaseansvarig. En vanlig källkods-ZIP från Git innehåller inte den flera gigabyte stora modellen och fungerar inte. Modellen och ZIP-filen är större än FAT32 klarar; USB-minnet måste använda ett godkänt storfilsformat (vanligen exFAT för Mac/Windows) och uppackningen måste stödja ZIP64. Kontrollera releasehash/signatur och den betrodda nyckelns fingeravtryck via organisationens separata, godkända kanal — filer som levereras tillsammans bevisar inte ensamma avsändaren.

### macOS 13 eller senare

1. Stäng av Wi-Fi och koppla från nätverkskabeln om du genomför ett air-gap-test.
2. Kopiera ZIP-filen från USB till en vanlig skrivbar mapp på datorn.
3. Dubbelklicka ZIP-filen och öppna den uppackade Aurora-mappen.
4. Dubbelklicka `build.command`. Om macOS visar sin normala kontroll för ett internt paket, bekräfta Öppna enligt organisationens rutin. Stäng inte av Gatekeeper globalt.
5. Vänta tills terminalfönstret visar `OK`. Kontrollsummor, databas, koordinatkonvertering och ett litet grammatikstyrt modelltest kontrolleras. Första modellstarten kan ta flera minuter.
6. Dubbelklicka `start.command`. Standardwebbläsaren öppnar den adress som skrivs ut, normalt `http://127.0.0.1:8474`.

### Windows 10/11 x64

1. Stäng av Wi-Fi och koppla från nätverkskabeln om du testar air-gap.
2. Kopiera ZIP-filen från USB till datorn. Högerklicka och välj **Extrahera alla**; kör inte direkt inne i den komprimerade mappen.
3. Öppna den uppackade Aurora-mappen och dubbelklicka `build.bat`.
4. Vänta på `OK`. Administratörsbehörighet ska normalt inte behövas.
5. Dubbelklicka `start.bat`. Webbläsaren öppnar den utskrivna `127.0.0.1`-adressen.

Om build säger att `checksums.txt`, en runtime, `llama-server`, npm-lagret eller GGUF-modellen saknas har du inte ett komplett releasepaket. Försök inte ladda ned något på måldatorn. Ta tillbaka USB:t till releaseansvarig, som ska köra `prepare_release` på en internetansluten byggdator.

## Starta och avsluta

- Starta med `start.command` på Mac eller `start.bat` på Windows. Om Aurora redan körs öppnas bara samma adress igen.
- Stoppa med `stop.command` eller `stop.bat`. Data, installation och exporter ligger kvar.
- Stäng gärna webbläsarfliken efter stopp; fliken i sig stoppar inte processerna.
- Om standardporten är upptagen väljer Aurora nästa lediga port och skriver ut rätt adress.

För en särskild port från terminal/Kommandotolken:

```text
start --port 9090 --llm-port 9091
```

Adressen är fortfarande endast `127.0.0.1`. Aurora kan inte göras tillgängligt för andra datorer genom en inställning.

## Lägg in en 7S-rapport

1. Öppna fliken **Inmatning** och välj **Klistra in 7S-rapport**.
2. Klistra in en märkt 7S-lista eller fri text. Flera rapporter kan klistras in samtidigt.
3. Välj **Strukturera med AI**. Köjobbet syns som väntande/körs/klart/misslyckat och kan avbrytas.
4. Kontrollera varje förhandsgranskningskort. Fält med osäkerhet är markerade. Jämför med originaltexten, rätta tid/plats/antal/begrepp och kontrollera att rapporter delats korrekt.
5. Välj **Spara till liggaren** för varje godkänd rapport. Inget AI-resultat sparas utan detta steg.

Välj manuell nyregistrering om LLM-status är nere eller om du vill börja med ett tomt formulär. Alla manuella funktioner fungerar utan modellen.

### Tider och platser

Aurora bevarar tidsuttrycket exakt och lagrar en normaliserad UTC-tid när det är möjligt. Relativa uttryck som ”i går kväll” markeras osäkra. DTG visas tillsammans med lokal tid.

En angiven MGRS- eller WGS84-position konverteras och valideras lokalt. Ett ortnamn blir inte automatiskt en exakt koordinat. En rapport utan validerbar position sparas med **⚑ Position saknas**, kan filtreras och visas i kartans räknare. Välj **Lägg till position**, mata in MGRS eller latitud/longitud och kontrollera båda formaten innan du sparar.

### Begrepp

AI och gränssnitt får bara använda aktiva värden ur **Begreppslistan**. Om inget passar används `ÖVRIGT/OKÄNT`. Du kan skapa, ordna, definiera och inaktivera begrepp; inaktivering ändrar inte gamla ärenden. `ÖVRIGT/OKÄNT` kan inte tas bort eller inaktiveras.

## Liggare och karta

Tabellen och kartan visar samma filtrerade urval. Du kan:

- fritextsöka i alla textfält, inklusive originalrapporten;
- filtrera på datum, begrepp, status, tagg, stjärna, aktör och saknad position;
- begränsa tabellen till aktuell kartutbredning;
- gruppera på begrepp, status, dag, tagg eller MGRS-ruta;
- stjärnmärka, tagga och redigera enkla fält direkt;
- öppna detaljpanelen för originaltext, AI-JSON, bedömning och anteckningar.

Markera eller håll pekaren över en rad för att markera karttecknet, och klicka ett karttecken för att öppna ärendet. Kartan använder en lokal, schematisk vektorkarta och får inte användas för navigation, gränstolkning, avstånd med operativ precision eller målangivelse. Pekarvisningen anger MGRS och WGS84 samtidigt.

Aktör styr APP-6-färg/ram: Okänd, Misstänkt främmande, Civil eller Egen. Detta är en användarbedömning, inte en slutsats som får antas av symbolens utseende.

## Spaningsfrågor

När liggaren innehåller fler än den inställda tröskeln (standard 3) kan AI föreslå upp till fem spaningsfrågor. Varje förslag visar motivering, prioritet och länkade verkliga ärenden. Kontrollera att frågan är konkret, observerbar, laglig och faktiskt minskar en informationslucka. **Acceptera** gör den Aktiv; du kan redigera, markera Besvarad eller Avförd och skriva anteckningar. Befintliga frågor skickas med för att minska dubbletter.

## Fråga AI och Bedöm

I **Fråga AI** söker backend först fram högst cirka 40 relevanta rader och modellen får endast dessa. Svaret visar citerade ärenden; klicka en citering för att markera tabellrad och karttecken. Ett kluster/rutt/trend visas bara när bifogade rader stöder det. Ett korrekt svar kan vara att underlaget inte räcker.

**Bedöm** på ett eller flera ärenden returnerar separata fält för FAKTA och BEDÖMNING, en av fem sannolikhetsnivåer och motivering. Kunskapsbanken ger detektionskontext, inte nya fakta. Kontrollera alternativa förklaringar och spara endast efter egen prövning.

## LLM-status och modellbyte

Statuschipet visar om den lokala modellen laddar, är klar eller är nere. Under laddning/nedtid är AI-knappar avstängda med förklaring, men liggare, karta, sökning, redigering, import/export och anteckningar fortsätter fungera. Processvakten försöker starta om llama-server med växande väntetid.

En annan instruktionsanpassad GGUF kan läggas i `llm/models/` och väljas under Inställningar. Normal start avvisar en modell som inte är pinnad och manifestverifierad. Ett undantag kräver `start --allow-unverified-model` vid varje start, ger en tydlig varning och ska köras i organisationens godkända OS-sandbox/VM eftersom GGUF är indata till en native-parser. Verifiera proveniens och genomför alltid extraktions- och grammatiktest innan operativ användning.

## Export, import och automatisk lagring

SQLite-databasen sparas kontinuerligt i `data/aurora.db`. Efter varje skrivning uppdateras `data/mirror/liggare.csv`. En full XLSX-backup skapas vid start och normalt var 30:e minut; de 20 senaste behålls.

Exportera alla eller filtrerade rader till XLSX eller CSV. Full XLSX har bladen **Liggare**, **Spaningsfrågor** och **Begrepp** och är formatet för full återställning. CSV är UTF-8 med BOM och använder normalt semikolon för svensk Excel.

Vid import visas kolumnmappning och en förhandsgranskning. Dubblettvarning jämför tid + MGRS + slag. Välj uttryckligen sammanfogning eller tillägg och kontrollera resultatet innan bekräftelse.

## Säker återställning (teardown)

`teardown` motsvarar ”nedmontera lokal installation”:

1. Aurora stoppas.
2. Om databasen finns skrivs `exports/aurora-final-<datum-tid>.xlsx` och `.csv`. Om någon fil misslyckas eller blir tom raderas ingenting.
3. Arbetsdatabas, loggar, PID-filer, uppackad runtime, installerade npm-paket, lokala cachefiler och `config/app.local.json` tas bort.
4. Källkod, byggd webb, runtime-/llamaarkiv, modeller, offline npm-lager och `exports/` bevaras.

Kör `build --restore-latest` för en ny installation med senaste fulla snapshot. `teardown --no-export` hoppar uttryckligen över snapshot. `teardown --purge-exports` raderar även exporter men kräver att du skriver `RADERA AURORA` exakt; detta kan inte ångras.

## Inställningar och lokala filer

Språk, operatörsnamn, banner, sannolikhetsskala, tröskel, backuptid, modell och portar sparas i `config/app.local.json`. Standarder finns i `config/app.defaults.json`. Kunskapsfilerna i `knowledge/` är redigerbar svensk Markdown och läses om till nästa relevanta AI-jobb. Promptmallarna finns i `docs/PROMPTS.md`; ändringar bör granskas och funktionstestas eftersom JSON-regler och mänsklig kontroll är säkerhetsgränser.

## Felsökning

- **Webbläsaren öppnas inte:** använd exakt `http://127.0.0.1:<port>` som startfönstret skrev ut. Använd inte datornamn eller `0.0.0.0`.
- **Port upptagen:** start väljer automatiskt nästa lediga. Ange `--port` endast om en bestämd lokal port behövs.
- **LLM laddar länge:** en 7B-modell kan ta flera minuter på CPU. Kontrollera `data/logs/llama.log`; manuella funktioner ska fungera.
- **AI nere:** stoppa och starta igen. Om status förblir nere, kontrollera att vald `.gguf` finns och att `data/logs/llama.log` inte visar minnes- eller modellfel.
- **Build stoppar på kontrollsumma:** paketet är ofullständigt eller ändrat. Använd inte det; hämta en ny intern release.
- **Position kan inte konverteras:** kontrollera MGRS-zon, band, rutbokstäver och jämnt antal siffror, eller ange validerad WGS84.
- **Loggar:** finns endast i `data/logs/`. Undvik att skicka dem utanför godkänd miljö; rå rapporttext loggas inte på info-nivå.

Kortkommandon: `/` fokuserar sökning, `n` nytt ärende, `s` stjärnmarkerar valt ärende och `?` visar hjälp. Fokusmarkering och reduced-motion följer tillgänglighetsinställningar.
