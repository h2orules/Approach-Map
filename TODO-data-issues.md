# Data issues

Appended by scripts/validateStaticData.ts. Each distinct failure class below is
advisory and should be fixed in its own follow-up diff (e.g. a CIFP parser edge
case at a small field, an OurAirports metadata gap). Re-running the validator
appends a fresh dated section; prune resolved entries as you fix them.

## 2026-07-09T04:36:22.338Z
- [offline] index rows: 6/3017 (0.2%) e.g. PKMJ: coord: outside US/territory bounds (7.06511,171.271656)
- [offline] shards: 6/3017 (0.2%) e.g. PKMJ: coord: outside US/territory bounds (7.06511,171.271656)

## 2026-07-09T04:36:36.762Z
- [offline] index rows: 6/3017 (0.2%) e.g. PKMJ: coord: outside US/territory bounds (7.06511,171.271656)
- [offline] shards: 6/3017 (0.2%) e.g. PKMJ: coord: outside US/territory bounds (7.06511,171.271656)
