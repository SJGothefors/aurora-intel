---
id: und_grund
title: Underrättelsegrunder enligt R UND 2022 för AURORA
language: sv
tags: [7S, fakta, bedömning, sannolikhet, spaningsfråga, källkritik]
actors: []
begrepp: [ÖVRIGT/OKÄNT]
updated: 2026-08-10
---

# Underrättelsegrunder

Detta är en kort metodisk referens hämtad ur Försvarsmaktens offentliga **Reglemente Underrättelsetjänst 2022 (R UND 2022)**, främst kapitel 3–5 och bilaga 2–4. Den ersätter inte order, säkerhetsskyddsbestämmelser eller utbildning. AURORA ska aldrig fylla luckor med antaganden som om de vore observationer.

## 7S som observationsformat

En 7S-rapport skiljer sju frågor åt:

1. **Stunden** – när observationen gjordes. Bevara alltid originaluttrycket. Normalisera till UTC endast när det kan göras spårbart. Relativa tider som ”i går kväll” markeras osäkra och räknas från registreringstidpunkten.
2. **Stället** – var. Dela upp uttrycklig MGRS, ort och specifikt platsnamn i respektive fält. Exempel: `33V XF 49948 64772 (Södertälje centrum)` ger MGRS `33VXF 49948 64772`, ort `Södertälje` och platsnamn `Södertälje centrum`. Gissa inte en koordinat från ett ortnamn; originalrapporten bevaras för spårbarhet.
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

## Bearbetning och värdering enligt R UND 2022

Bearbetning ska vara spårbar och systematisk: registrera och strukturera först, värdera därefter, analysera möjliga hypoteser, sammanställ relationer och mönster i tid och rum och tolka slutligen aktivitet, identitet, innebörd och slutsats. Registrering eller analys får inte bli ett självändamål som fördröjer viktig delgivning.

Källans eller uppgiftslämnarens **tillförlitlighet** (A–F) och informationens **sakriktighet** (1–6) är två oberoende värderingar. De får inte blandas ihop med sannolikheten i en analytisk bedömning. `SOURCE ASSESSMENT` i AURORA väljs manuellt; modellen får inte skapa en källvärdering utan redovisat underlag. Kontrollera också om till synes bekräftande rapporter har samma ursprung för att undvika cirkelrapportering.

Analys av frågor med flera möjliga svar bör utgå från alternativa hypoteser och söka både stödjande och motsägande information. Tolkningen ska tydligt skilja fakta från antaganden, redovisa avgörande antaganden och kvarstående osäkerheter samt knyta indikatorer och informationsluckor till observerbar verksamhet, tid och plats. Väder kan vara en begränsande eller möjliggörande faktor men får bara användas när väderuppgifter faktiskt finns.

Konfidens beskriver hur välgrundad bedömningen är utifrån underlagets kvalitet och mängd, källornas oberoende, antaganden samt bearbetningens tid och resurser. R UND använder **hög**, **medel** och **låg** konfidens. Konfidens är inte samma sak som bedömningens sannolikhetsord och ska inte räknas fram mekaniskt.

## Uttryckssätt i bedömningar

Använd alltid endast den sannolikhetsskala som är aktiv i AURORA. R UND 2022 använder nationellt följande uttryck som referens:

- **Sannolik** – över 80 procent; flera tydliga faktorer, hög sakriktighet och tillförlitlighet från flera oberoende källor.
- **Troligen** – 55–75 procent; flera faktorer stödjer men innebörden är inte entydig eller källunderlaget är begränsat.
- **Möjligen** – 25–50 procent; ett fåtal faktorer och flera rimliga tolkningar med stor osäkerhet.
- **Tveksam** – under 20 procent; svagt positivt stöd men inget avgörande som helt utesluter prognosen.

**Bekräftad** används bara för verifierade fakta, aldrig som prognos eller sannolikhetsord. Procentsatserna är ett tolkningsstöd, inte ett matematiskt resultat. Motiveringen ska vara kort, prövbar och proportionerlig mot underlaget.

## En bra spaningsfråga

En spaningsfråga minskar en konkret informationslucka. Den är observerbar eller detekterbar, möjlig att inhämta och rapportera i tid, anpassad till disponibla resurser och avgränsad i tid, rum eller objekt utan att förutsätta slutsatsen. Bra form: ”Vilka registreringsnummer, riktningar och tider kan observeras för de lastbilar som passerar plats X under period Y?” Svag form: ”Är aktören fientlig?”

Varje fråga ska länka till de ärenden som motiverar den, ange varför svaret spelar roll, när svaret senast är av värde och undvika dubbletter. AURORAs prioritet **Hög** motsvarar information som är avgörande eller tydligt reducerar risk, **Medel** stödjer pågående planering eller beslut och **Låg** är bakgrundsinformation. Förslag till inhämtning ska hållas på observationsnivå och följa gällande order och lag. Om underlaget inte räcker är ”underlaget räcker inte” ett korrekt resultat.
