// Maps each airport ICAO in public/data/airports.json to an ordered list of
// candidate FAA TRACON facility IDs, used to build MVA/MIA XML filenames
// (`<FACILITY>_MVA_FUS3.xml` / `_FUS5.xml`) in src/services/mvaData.ts.
//
// Cross-checked against the live FAA index (the <a href> list at
// https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/mva_mia/mva/,
// whose real files are served from aeronav.faa.gov/MVA_Charts/aixm/ — see the
// proxy comment in vite.config.ts, previously pointed at the wrong host/path
// entirely). Most entries below matched; a couple of "single-airport TRACON
// ID = the airport's own code" guesses had no corresponding published file
// (GRR, MFE, MLB, OMA, RNO, TUS) — those airports may not have a distinct
// chart under this naming convention, or use one filed under an ARTCC-wide
// name not covered here. `ensureMvaLoaded` tries every candidate in order and
// silently moves on if all 404 — a wrong/missing entry just means that
// airport shows no MVA layer, not a crash. If a facility 404s in practice,
// open the index page above, find the real filename, and fix the entry here.
export const MVA_FACILITIES: Record<string, string[]> = {
  // --- High-confidence: large consolidated/named TRACONs ---
  KATL: ['A80'], // Atlanta TRACON
  KBOS: ['A90'], // Boston Consolidated TRACON (also covers KPVD, KBDL area)
  KPVD: ['A90'],
  KBDL: ['BDL', 'A90'],
  KORD: ['C90'], // Chicago TRACON
  KMDW: ['C90'],
  KDFW: ['D10'], // DFW TRACON
  KDAL: ['D10'],
  KDEN: ['D01_DEN_PUB', 'D01'], // Denver TRACON (published filename has a "_DEN_PUB" suffix, unlike other single-TRACON airports)
  KDTW: ['D21'], // Detroit TRACON
  KIAH: ['I90'], // Houston TRACON
  KHOU: ['I90'],
  KLAS: ['L30'], // Las Vegas TRACON
  KHND: ['L30'],
  KMSP: ['M98'], // Minneapolis-St Paul TRACON
  KMIA: ['MIA'], // Miami TRACON (also covers Ft Lauderdale, Palm Beach)
  KFLL: ['MIA'],
  KPBI: ['MIA'],
  KPDX: ['P80'], // Portland TRACON
  KSPB: ['P80'],
  KPHX: ['P50'], // Phoenix TRACON
  KSDL: ['P50'],
  KPHL: ['PHL'], // Philadelphia TRACON
  KDCA: ['PCT'], // Potomac Consolidated TRACON
  KIAD: ['PCT'],
  KBWI: ['PCT'],
  KSEA: ['S46'], // Seattle TRACON
  KSLC: ['S56'], // Salt Lake City TRACON
  KSTL: ['T75'], // St Louis TRACON
  KLAX: ['SCT'], // SoCal TRACON
  KSAN: ['SCT'],
  KSNA: ['SCT'],
  KONT: ['SCT'],
  KBUR: ['SCT'],
  KSFO: ['NCT'], // NorCal TRACON
  KOAK: ['NCT'],
  KSJC: ['NCT'],
  KSMF: ['NCT'],
  KMHR: ['NCT'],
  KJFK: ['N90'], // New York TRACON
  KLGA: ['N90'],
  KEWR: ['N90'],
  KCLT: ['CLT'], // Charlotte TRACON
  KPIT: ['PIT'], // Pittsburgh TRACON
  KCVG: ['CVG'], // Cincinnati TRACON
  KCLE: ['CLE'], // Cleveland TRACON
  PANC: ['A11'], // Anchorage TRACON
  PHNL: ['HCF'], // Honolulu Control Facility
  KTPA: ['TPA'], // Tampa TRACON
  KMCO: ['F11'], // Orlando TRACON
  KMEM: ['M03'], // Memphis TRACON
  KABQ: ['ABQ'], // Albuquerque TRACON (source of the verified sample file)

  // --- Best-effort: single-airport/regional TRACONs, ID guessed as the
  //     airport's own facility code. Genuinely unverified. ---
  KAUS: ['AUS'],
  KBHM: ['BHM'],
  KBNA: ['BNA'],
  KBUF: ['BUF'],
  KCOS: ['COS'],
  KCRW: ['CRW'],
  KELP: ['ELP'],
  KGRR: ['GRR'],
  KGSO: ['GSO'],
  KIND: ['IND'],
  KJAX: ['JAX'],
  KLBB: ['LBB'],
  KLIT: ['LIT'],
  KLOU: ['SDF', 'LOU'], // Bowman Field traffic is worked by Louisville (Standiford) approach
  KMCI: ['MCI'],
  KMKC: ['MCI'],
  KMKE: ['MKE'],
  KMLB: ['MLB'],
  KMOB: ['MOB'],
  KMSY: ['MSY'],
  KMFE: ['MFE'],
  KOMA: ['OMA'],
  KORF: ['ORF'],
  KRDU: ['RDU'],
  KRNO: ['RNO'],
  KROC: ['ROC'],
  KRSW: ['RSW'],
  KSAT: ['SAT'],
  KSAV: ['SAV'],
  KSBN: ['SBN'],
  KSYR: ['SYR'],
  KTUL: ['TUL'],
  KTUS: ['TUS'],
}
