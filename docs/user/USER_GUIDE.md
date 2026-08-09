# Operator guide

[Documentation home](../INDEX.md) · [User documentation](INDEX.md) · [Start and stop](START.md) · [Technical documentation](../technical/INDEX.md)

## Add a report

Open **New case**. In **Paste report**, paste the original 7S text and manually choose **Source assessment**. The AI must not choose this value. Review the structured preview before saving. **Manual entry** exposes the full ledger when no model is available.

7S remains in this order: **Stund, Ställe, Styrka, Slag, Sysselsättning, Symbol, Sagesman**. A leading six-digit time/source number is stored as the original report ID. The ledger is a concise summary, not a 1:1 copy: **TIME, PLACE, NAME, TYPE, ACTIVITY, TRAITS, SOURCE, SOURCE ASSESSMENT, STATUS**.

Click a ledger row to expand its original report and metadata inside the table. Use **Open full editor** only when values must change. Place shows the place name first and coordinates when no name exists. NAME is the direct `slag`; TYPE is the controlled `begrepp` category.

## Weather

Use **Add / manage** above the map. Enter one to three time points per day for up to five coming days: temperature, rain, humidity and cloud cover are individually optional. Old points are automatically deleted when more than two days old. Weather is manual evidence: verify its source outside Aurora and leave fields empty when unknown.

## Automated assessment

At three saved reports, the local model schedules a consolidated assessment. It updates after case changes and can be refreshed manually. It receives bounded recent reports, relevant knowledge-bank excerpts and the optional manual weather. Facts, assessment and recommendation stay separate. Treat every output as a draft requiring officer review.

## Map and work panel

The right side uses the upper portion for the weather/map picture and the lower portion for assessment and collection priorities. Map labels use NAME/`slag`; controlled TYPE is also visible in the case details. The New case, Ask AI and Collection questions tools open as a drawer. Click outside the drawer to close it.
