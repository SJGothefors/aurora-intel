# Operator guide

[Documentation home](../INDEX.md) · [User documentation](INDEX.md) · [Start and stop](START.md) · [Technical documentation](../technical/INDEX.md)

> **About the screenshots:** Every name, report, position and assessment shown below is synthetic exercise data. The local model was deliberately stopped for most captures, which also demonstrates that the manual ledger, map and editing functions remain available without AI.

## Add a report

Open **New case**. In **Paste report**, paste the original 7S text and manually choose **Source assessment**. The AI must not choose this value. Review the structured preview before saving. **Manual entry** exposes the full ledger when no model is available.

![New-report drawer with a synthetic 7S report and manually selected source assessment](assets/guide-report-intake.jpg)

*The original report stays visible while the officer sets the source assessment. Structure with AI is disabled whenever the local model is stopped.*

7S remains in this order: **Stund, Ställe, Styrka, Slag, Sysselsättning, Symbol, Sagesman**. A leading six-digit time/source number is stored as the original report ID. The ledger is a concise summary, not a 1:1 copy: **TIME, PLACE, NAME, TYPE, ACTIVITY, TRAITS, SOURCE, SOURCE ASSESSMENT, STATUS**.

Click a ledger row to expand its original report and metadata inside the table. Use **Open full editor** only when values must change. Place shows the place name first and coordinates when no name exists. NAME is the direct `slag`; TYPE is the controlled `begrepp` category.

![Full case view showing source report ID, type, place name and MGRS](assets/guide-case-overview.jpg)

*The case header shows the source report ID and reported type. The 7S overview keeps locality, specific place name and MGRS in separate fields.*

## Weather

Use **Add / manage** above the map. Enter one to three time points per day for up to five coming days: temperature, rain, humidity and cloud cover are individually optional. Old points are automatically deleted when more than two days old. Weather is manual evidence: verify its source outside Aurora and leave fields empty when unknown.

![Ledger, manual weather strip, map and assessment area](assets/guide-ledger-map.jpg)

*The ledger and map share the same filtered set. The weather strip is manually entered and must not be treated as automatically verified evidence.*

## Automated assessment

At three saved reports, the local model schedules a consolidated assessment. It updates after case changes and can be refreshed manually. It receives bounded recent reports, relevant knowledge-bank excerpts and the optional manual weather. Facts, assessment and recommendation stay separate. Treat every output as a draft requiring officer review.

![Case assessment tab with a stored draft assessment](assets/guide-case-assessment.jpg)

*A saved assessment remains visible in the case. Use Bedöm med AI to generate a new draft only when the local model is available.*

## Map and work panel

The right side uses the upper portion for the weather/map picture and the lower portion for assessment and collection priorities. Map labels use NAME/`slag`; controlled TYPE is also visible in the case details. The New case, Ask AI and Collection questions tools open as a drawer. Click outside the drawer to close it.

![Collection-question drawer with active and proposed questions linked to cases](assets/guide-collection-questions.jpg)

*Each collection question shows status, priority, reason, proposed collection and linked cases. Review and activate proposals deliberately.*

## Controlled vocabulary

Open **Vocabulary** from the top bar to create, edit, order, activate or deactivate controlled terms. Swedish and English names are required. The definition helps both operators and the local model choose consistently. **SIDC is optional**; leaving it blank assigns the neutral default symbol. `ÖVRIGT/OKÄNT` remains protected.

![Vocabulary editor showing a synthetic custom term and optional SIDC hint](assets/guide-vocabulary.jpg)

*Selecting a row opens its editor. Changes affect future selections; historical cases retain their saved term unless the term itself is renamed.*
