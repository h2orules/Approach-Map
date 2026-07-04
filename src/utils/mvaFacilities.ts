// Maps each airport ICAO in public/data/airports.json to an ordered list of
// candidate FAA TRACON facility IDs, used to build MVA/MIA XML filenames
// (`<FACILITY>_MVA_FUS3.xml` / `_FUS5.xml`) in src/services/mvaData.ts.
//
// UNVERIFIED: this table was built from general ATC-facility knowledge, not
// from the live FAA MVA/MIA index (that page is blocked from this sandbox —
// see the proxy comment in vite.config.ts). A handful of entries are
// well-established (e.g. N90=New York, C90=Chicago, SCT/NCT=SoCal/NorCal,
// PCT=Potomac Consolidated — these combine many airports under one TRACON),
// but many single-airport TRACON IDs below are a best-effort guess (often
// just the airport's own 3-letter code) and may not match the actual
// published filename. `ensureMvaLoaded` tries every candidate in order and
// silently moves on if all 404 — a wrong/missing entry just means that
// airport shows no MVA layer, not a crash. If a facility 404s in practice,
// open the FAA MVA/MIA page in a browser, find the real filename, and fix
// the entry here.
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
  KDEN: ['D01'], // Denver TRACON
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
