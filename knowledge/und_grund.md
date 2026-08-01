---
id: und_grund
title: Underrättelsegrunder för AURORA
language: sv
tags: [7S, fakta, bedömning, sannolikhet, spaningsfråga, källkritik]
actors: []
begrepp: [ÖVRIGT/OKÄNT]
updated: 2026-08-01
---

# Underrättelsegrunder

Detta är en metodisk referens för strukturering och analys av uppgifter som redan har rapporterats. Den ersätter inte order, säkerhetsskyddsbestämmelser eller utbildning. AURORA ska aldrig fylla luckor med antaganden som om de vore observationer.

## 7S som observationsformat

En 7S-rapport skiljer sju frågor åt:

1. **Stunden** – när observationen gjordes. Bevara alltid originaluttrycket. Normalisera till UTC endast när det kan göras spårbart. Relativa tider som ”i går kväll” markeras osäkra och räknas från registreringstidpunkten.
2. **Stället** – var. Bevara platsbeskrivningen och lagra både MGRS och WGS84 när en validerad konvertering är möjlig. Ett ortnamn är inte automatiskt en exakt position.
3. **Styrkan** – antal personer, fordon eller objekt. Skilj exakt antal, intervall, ungefärligt antal och okänt antal.
4. **Slaget** – vad som faktiskt iakttogs. Använd observerbara beskrivningar före typ- eller aktörsattribution.
5. **Sysselsättningen** – aktivitet, riktning, varaktighet och förlopp. Skriv vad objektet gjorde, inte vilket syfte observatören tror att det hade.
6. **Symbolen** – märkning, registrering, flagga, klädsel eller andra särskiljande drag. Frånvaro av synlig märkning är inte samma sak som bekräftad omärkt verksamhet.
7. **Sagesmannen** – vem eller vilken logg/sensor som lämnat uppgiften. AURORA värderar inte en persons trovärdighet utan redovisat underlag.

Fält som saknas får värdet `null` och anges i `fields_uncertain`. Originalrapporten bevaras oförändrad så att varje strukturerat värde kan kontrolleras.

## FAKTA och BEDÖMNING

**FAKTA** är det som källan faktiskt rapporterat, plus tekniskt verifierbara härledningar som en korrekt MGRS-konvertering. Att en rapport finns är ett faktum; att dess innehåll är korrekt kan fortfarande vara osäkert.

**BEDÖMNING** är analytikerns tolkning. Den ska:

- ange vilka rapporterade fakta den vilar på;
- skilja hypotes från bekräftad händelse;
- redovisa rimliga alternativa förklaringar;
- beskriva informationsluckor och vad som skulle kunna ändra bedömningen;
- aldrig tillskriva en aktör avsikt, identitet eller skuld utan tillräckligt underlag.

Flera rapporter är inte oberoende bekräftelse om de kan härröra från samma ursprung. Närhet i tid eller rum kan vara ett mönster, men kan också bero på rapporteringsrutiner, trafik eller slump.

## Sannolikhetsskala

Använd endast den lokalt konfigurerade femgradiga skalan:

- **mycket osannolikt** – hypotesen har mycket svagt stöd och tydligare alternativ finns;
- **osannolikt** – underlaget talar mer emot än för;
- **möjligt** – underlaget medger hypotesen men skiljer den inte tydligt från alternativ;
- **sannolikt** – flera relevanta uppgifter talar för hypotesen och alternativen är svagare;
- **mycket sannolikt** – samstämmigt, relevant underlag ger starkt stöd, samtidigt som absolut visshet inte påstås.

Skalan uttrycker analytisk sannolikhet, inte procenttal och inte källans tillförlitlighet. Motiveringen ska vara kort, prövbar och proportionerlig mot underlaget.

## En bra spaningsfråga

En spaningsfråga minskar en konkret informationslucka. Den är observerbar, avgränsad i tid/rum och möjlig att besvara utan att förutsätta slutsatsen. Bra form: ”Vilka registreringsnummer, riktningar och tider kan observeras för de lastbilar som passerar plats X under period Y?” Svag form: ”Är aktören fientlig?”

Varje fråga ska länka till de ärenden som motiverar den, ange varför svaret spelar roll och undvika dubbletter. Förslag till inhämtning ska hållas på observationsnivå och följa gällande order och lag. Om underlaget inte räcker är ”underlaget räcker inte” ett korrekt resultat.
