---
id: begrepp_exempel
title: Träningsexempel för kontrollerade begrepp
language: sv
tags: [begrepp, exempel, klassificering, 7S, träning]
actors: []
begrepp: [ÖVRIGT/OKÄNT]
updated: 2026-08-09
---

# Exempel för val av TYPE/begrepp

TYPE är ett eller flera ord ur den aktiva kontrollerade listan. NAME/slag behåller den direkta observationen. Modellen får inte uppfinna ett begrepp. När underlaget inte räcker används `ÖVRIGT/OKÄNT` och fältet markeras osäkert.

| Kort 7S-slag/aktivitet | NAME i liggaren | Lämpligt TYPE | Viktig avgränsning |
|---|---|---|---|
| “2 T-90 framrycker längs väg” | T-90 | FORDON MIL / STRIDSFORDON | Registrera två som styrka; aktivitet högst “framrycker längs väg” |
| “vit pickup står vid grind, fotograferar” | vit pickup | FORDON CIVILT AVVIKANDE och eventuellt SPANING/REKOGNOSERING | Fotografering är inte automatiskt fientlig; om avvikelsen är oklar välj hellre bara fordon/okänt |
| “fyra beväpnade personer till fots” | beväpnad personal | PERSONAL/TRUPP | Aktivitet beskriver rörelse/uppehåll, inte antaget syfte |
| “quadcopter cirklar över området” | quadcopter | UAS/DRÖNARE | Ljus eller ljud utan visuell bekräftelse kan vara `ÖVRIGT/OKÄNT` |
| “helikopter landar på fält” | helikopter | HELIKOPTER | Aktör och militär/civil status hålls okänd utan märkning eller annan verifiering |
| “lastfartyg avviker från farled och ligger still” | lastfartyg | FARTYG CIVILT AVVIKANDE | Tekniskt fel, väder och normal ankring är alternativ |
| “återkommande frågor om vaktschema” | person | UNDERRÄTTELSEVERKSAMHET eller SPANING/REKOGNOSERING | Kräver konkret icke-offentlig fråga/upprepning; vardaglig fråga räcker inte |
| “GNSS-position hoppar samtidigt i tre mottagare” | GNSS-avvikelse | SIGNALSTÖRNING/GNSS | TYPE beskriver effekt, inte avsändare eller avsikt |
| “obehörig passage över fastställd gräns” | gränspassage | GRÄNSKRÄNKNING | Kontrollera gräns, position och behörighet; kartfel är alternativ |
| “kabelskåp uppbrutet, fiber skadad” | skadat kabelskåp | SABOTAGE/SKADEGÖRELSE och KRITISK INFRASTRUKTUR | Skada är fakta; sabotage som avsikt kan vara osäkert |
| “tankbil och tre lastbilar lossar materiel” | logistikkolonn | LOGISTIK/TRANSPORT | Specificera fordon i NAME/styrka och lossa materiel i aktivitet |
| “förband övar avsittning på övningsfält” | förband | ÖVNING/UTBILDNING | En rapporterad övning ska inte omklassas som förberedelse utan särskilt stöd |
| “okänd lukt och flera personer med andningsbesvär” | okänd exponering | CBRN eller ÖVRIGT/OKÄNT | Följ akut rutin; ämne och orsak är okända tills specialist bekräftar |
| “krossad ruta utan annan aktivitet” | krossad ruta | SABOTAGE/SKADEGÖRELSE | NAME får vara vardagligt; typ behöver inte vara ett militärt objekt |
| “person går runt med kamera på turistplats” | person med kamera | ÖVRIGT/OKÄNT | Laglig normal aktivitet; välj inte spaning utan konkreta avvikande omständigheter |

## Sammanfattningsregler för liggaren

- `ACTIVITY`: högst fyra bärande ord från sysselsättningen, exempelvis “framrycker norrut längs väg”.
- `TRAITS`: högst fyra bärande ord från symbolen, exempelvis “vit, kryss, reg ABC123”.
- `SOURCE`: kopiera sagesman, normalisera inte personens namn eller sensorbeteckning.
- `SOURCE ASSESSMENT`: väljs manuellt av underrättelseofficer; modellen får inte gissa.
- När flera begrepp passar, välj endast de som stöds direkt av texten. Prioritera inte en dramatisk kategori framför `ÖVRIGT/OKÄNT`.
