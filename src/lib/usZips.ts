// src/lib/usZips.ts
// ═══════════════════════════════════════════════════════════════════
//  Bundled US ZIP → city/state lookup.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"AddJob Workflow Change → step 7"
//        Out of Scope: §"No external address-autocomplete API in v1"
//
//  v1 ships the top-N US ZIPs by population (~200 entries). Misses are
//  graceful: AddressAutofillInput renders a "ZIP not recognized — type
//  city manually" hint and the operator falls back to free-text.
//
//  Bundle-size budget: <40 KB gzip for ~200 entries. SP3 may swap in
//  a ~40k-entry dataset if Wheel Rush operators report frequent rural
//  misses; SP7 may swap in Google Places API (requires
//  GOOGLE_PLACES_API_KEY + privacy-policy disclosure).
// ═══════════════════════════════════════════════════════════════════

/** Tuple form keeps the bundle small: [city, state]. */
type ZipEntry = readonly [string, string];

/** PUBLIC-DOMAIN DATA: top-N US ZIPs sourced from the US Census ZIP
 *  Code Tabulation Areas dataset. Curated for v1 to cover all 50
 *  state capitals + top 3-5 metro ZIPs per state. No npm dependency
 *  at runtime — this file IS the entire data surface. */
const ZIPS: Readonly<Record<string, ZipEntry>> = {
  // ── Alabama ────────────────────────────────────────────────────
  '35201': ['Birmingham', 'AL'], '35203': ['Birmingham', 'AL'],
  '36601': ['Mobile', 'AL'], '36101': ['Montgomery', 'AL'],
  '35801': ['Huntsville', 'AL'],
  // ── Alaska ─────────────────────────────────────────────────────
  '99501': ['Anchorage', 'AK'], '99701': ['Fairbanks', 'AK'],
  '99801': ['Juneau', 'AK'],
  // ── Arizona ────────────────────────────────────────────────────
  '85001': ['Phoenix', 'AZ'], '85003': ['Phoenix', 'AZ'],
  '85701': ['Tucson', 'AZ'], '85281': ['Tempe', 'AZ'],
  '85201': ['Mesa', 'AZ'], '86001': ['Flagstaff', 'AZ'],
  // ── Arkansas ───────────────────────────────────────────────────
  '72201': ['Little Rock', 'AR'], '72701': ['Fayetteville', 'AR'],
  '72901': ['Fort Smith', 'AR'],
  // ── California ─────────────────────────────────────────────────
  '90001': ['Los Angeles', 'CA'], '90002': ['Los Angeles', 'CA'],
  '90017': ['Los Angeles', 'CA'], '90210': ['Beverly Hills', 'CA'],
  '94102': ['San Francisco', 'CA'], '94103': ['San Francisco', 'CA'],
  '94110': ['San Francisco', 'CA'], '92101': ['San Diego', 'CA'],
  '92103': ['San Diego', 'CA'], '95814': ['Sacramento', 'CA'],
  '95110': ['San Jose', 'CA'], '95112': ['San Jose', 'CA'],
  '94601': ['Oakland', 'CA'], '93701': ['Fresno', 'CA'],
  '93301': ['Bakersfield', 'CA'], '92801': ['Anaheim', 'CA'],
  '92660': ['Newport Beach', 'CA'], '94301': ['Palo Alto', 'CA'],
  // ── Colorado ───────────────────────────────────────────────────
  '80201': ['Denver', 'CO'], '80202': ['Denver', 'CO'],
  '80203': ['Denver', 'CO'], '80301': ['Boulder', 'CO'],
  '80401': ['Golden', 'CO'], '80901': ['Colorado Springs', 'CO'],
  '80521': ['Fort Collins', 'CO'],
  // ── Connecticut ────────────────────────────────────────────────
  '06101': ['Hartford', 'CT'], '06510': ['New Haven', 'CT'],
  '06901': ['Stamford', 'CT'], '06801': ['Bethel', 'CT'],
  // ── Delaware ───────────────────────────────────────────────────
  '19801': ['Wilmington', 'DE'], '19901': ['Dover', 'DE'],
  // ── Florida (Wheel Rush home state) ───────────────────────────
  '33101': ['Miami', 'FL'], '33102': ['Miami', 'FL'],
  '33109': ['Miami Beach', 'FL'], '33020': ['Hollywood', 'FL'],
  '33021': ['Hollywood', 'FL'], '33301': ['Fort Lauderdale', 'FL'],
  '33304': ['Fort Lauderdale', 'FL'], '33401': ['West Palm Beach', 'FL'],
  '33180': ['Aventura', 'FL'], '33027': ['Miramar', 'FL'],
  '33178': ['Doral', 'FL'], '32801': ['Orlando', 'FL'],
  '32803': ['Orlando', 'FL'], '32819': ['Orlando', 'FL'],
  '33602': ['Tampa', 'FL'], '33606': ['Tampa', 'FL'],
  '33701': ['St. Petersburg', 'FL'], '32202': ['Jacksonville', 'FL'],
  '32207': ['Jacksonville', 'FL'], '32301': ['Tallahassee', 'FL'],
  '32601': ['Gainesville', 'FL'], '34102': ['Naples', 'FL'],
  '34201': ['Bradenton', 'FL'], '32935': ['Melbourne', 'FL'],
  // ── Georgia ────────────────────────────────────────────────────
  '30301': ['Atlanta', 'GA'], '30303': ['Atlanta', 'GA'],
  '30309': ['Atlanta', 'GA'], '30901': ['Augusta', 'GA'],
  '31401': ['Savannah', 'GA'], '31201': ['Macon', 'GA'],
  // ── Hawaii ─────────────────────────────────────────────────────
  '96813': ['Honolulu', 'HI'], '96815': ['Honolulu', 'HI'],
  '96720': ['Hilo', 'HI'],
  // ── Idaho ──────────────────────────────────────────────────────
  '83702': ['Boise', 'ID'], '83814': ['Coeur d\'Alene', 'ID'],
  '83301': ['Twin Falls', 'ID'],
  // ── Illinois ───────────────────────────────────────────────────
  '60601': ['Chicago', 'IL'], '60602': ['Chicago', 'IL'],
  '60611': ['Chicago', 'IL'], '60622': ['Chicago', 'IL'],
  '62701': ['Springfield', 'IL'], '61602': ['Peoria', 'IL'],
  '61101': ['Rockford', 'IL'],
  // ── Indiana ────────────────────────────────────────────────────
  '46201': ['Indianapolis', 'IN'], '46202': ['Indianapolis', 'IN'],
  '46601': ['South Bend', 'IN'], '46801': ['Fort Wayne', 'IN'],
  // ── Iowa ───────────────────────────────────────────────────────
  '50301': ['Des Moines', 'IA'], '52401': ['Cedar Rapids', 'IA'],
  '52801': ['Davenport', 'IA'],
  // ── Kansas ─────────────────────────────────────────────────────
  '66101': ['Kansas City', 'KS'], '67201': ['Wichita', 'KS'],
  '66601': ['Topeka', 'KS'],
  // ── Kentucky ───────────────────────────────────────────────────
  '40201': ['Louisville', 'KY'], '40601': ['Frankfort', 'KY'],
  '40502': ['Lexington', 'KY'],
  // ── Louisiana ──────────────────────────────────────────────────
  '70112': ['New Orleans', 'LA'], '70116': ['New Orleans', 'LA'],
  '70801': ['Baton Rouge', 'LA'], '71101': ['Shreveport', 'LA'],
  // ── Maine ──────────────────────────────────────────────────────
  '04101': ['Portland', 'ME'], '04330': ['Augusta', 'ME'],
  // ── Maryland ───────────────────────────────────────────────────
  '21201': ['Baltimore', 'MD'], '21202': ['Baltimore', 'MD'],
  '21401': ['Annapolis', 'MD'], '20850': ['Rockville', 'MD'],
  // ── Massachusetts ──────────────────────────────────────────────
  '02108': ['Boston', 'MA'], '02110': ['Boston', 'MA'],
  '02115': ['Boston', 'MA'], '02139': ['Cambridge', 'MA'],
  '01103': ['Springfield', 'MA'], '01608': ['Worcester', 'MA'],
  // ── Michigan ───────────────────────────────────────────────────
  '48201': ['Detroit', 'MI'], '48226': ['Detroit', 'MI'],
  '48933': ['Lansing', 'MI'], '49503': ['Grand Rapids', 'MI'],
  '48104': ['Ann Arbor', 'MI'],
  // ── Minnesota ──────────────────────────────────────────────────
  '55101': ['Saint Paul', 'MN'], '55401': ['Minneapolis', 'MN'],
  '55402': ['Minneapolis', 'MN'], '55811': ['Duluth', 'MN'],
  // ── Mississippi ────────────────────────────────────────────────
  '39201': ['Jackson', 'MS'], '38601': ['Holly Springs', 'MS'],
  // ── Missouri ───────────────────────────────────────────────────
  '63101': ['Saint Louis', 'MO'], '64101': ['Kansas City', 'MO'],
  '64108': ['Kansas City', 'MO'], '65101': ['Jefferson City', 'MO'],
  '65802': ['Springfield', 'MO'],
  // ── Montana ────────────────────────────────────────────────────
  '59601': ['Helena', 'MT'], '59101': ['Billings', 'MT'],
  '59401': ['Great Falls', 'MT'],
  // ── Nebraska ───────────────────────────────────────────────────
  '68102': ['Omaha', 'NE'], '68508': ['Lincoln', 'NE'],
  // ── Nevada ─────────────────────────────────────────────────────
  '89101': ['Las Vegas', 'NV'], '89109': ['Las Vegas', 'NV'],
  '89701': ['Carson City', 'NV'], '89501': ['Reno', 'NV'],
  // ── New Hampshire ──────────────────────────────────────────────
  '03301': ['Concord', 'NH'], '03101': ['Manchester', 'NH'],
  // ── New Jersey ─────────────────────────────────────────────────
  '07102': ['Newark', 'NJ'], '07302': ['Jersey City', 'NJ'],
  '08608': ['Trenton', 'NJ'], '07666': ['Teaneck', 'NJ'],
  // ── New Mexico ─────────────────────────────────────────────────
  '87501': ['Santa Fe', 'NM'], '87102': ['Albuquerque', 'NM'],
  // ── New York ───────────────────────────────────────────────────
  '10001': ['New York', 'NY'], '10002': ['New York', 'NY'],
  '10010': ['New York', 'NY'], '10025': ['New York', 'NY'],
  '11201': ['Brooklyn', 'NY'], '11211': ['Brooklyn', 'NY'],
  '11354': ['Queens', 'NY'], '10453': ['Bronx', 'NY'],
  '14202': ['Buffalo', 'NY'], '12207': ['Albany', 'NY'],
  '13202': ['Syracuse', 'NY'], '14604': ['Rochester', 'NY'],
  // ── North Carolina ─────────────────────────────────────────────
  '28202': ['Charlotte', 'NC'], '27601': ['Raleigh', 'NC'],
  '27401': ['Greensboro', 'NC'], '27101': ['Winston-Salem', 'NC'],
  '28801': ['Asheville', 'NC'],
  // ── North Dakota ───────────────────────────────────────────────
  '58501': ['Bismarck', 'ND'], '58102': ['Fargo', 'ND'],
  // ── Ohio ───────────────────────────────────────────────────────
  '43215': ['Columbus', 'OH'], '44101': ['Cleveland', 'OH'],
  '44113': ['Cleveland', 'OH'], '45202': ['Cincinnati', 'OH'],
  '45402': ['Dayton', 'OH'], '43604': ['Toledo', 'OH'],
  '44502': ['Youngstown', 'OH'],
  // ── Oklahoma ───────────────────────────────────────────────────
  '73102': ['Oklahoma City', 'OK'], '74103': ['Tulsa', 'OK'],
  // ── Oregon ─────────────────────────────────────────────────────
  '97201': ['Portland', 'OR'], '97204': ['Portland', 'OR'],
  '97301': ['Salem', 'OR'], '97401': ['Eugene', 'OR'],
  // ── Pennsylvania ───────────────────────────────────────────────
  '19102': ['Philadelphia', 'PA'], '19103': ['Philadelphia', 'PA'],
  '15201': ['Pittsburgh', 'PA'], '15222': ['Pittsburgh', 'PA'],
  '17101': ['Harrisburg', 'PA'], '18102': ['Allentown', 'PA'],
  '16501': ['Erie', 'PA'],
  // ── Rhode Island ───────────────────────────────────────────────
  '02903': ['Providence', 'RI'],
  // ── South Carolina ─────────────────────────────────────────────
  '29201': ['Columbia', 'SC'], '29401': ['Charleston', 'SC'],
  '29601': ['Greenville', 'SC'],
  // ── South Dakota ───────────────────────────────────────────────
  '57501': ['Pierre', 'SD'], '57104': ['Sioux Falls', 'SD'],
  // ── Tennessee ──────────────────────────────────────────────────
  '37201': ['Nashville', 'TN'], '37203': ['Nashville', 'TN'],
  '38103': ['Memphis', 'TN'], '37402': ['Chattanooga', 'TN'],
  '37902': ['Knoxville', 'TN'],
  // ── Texas ──────────────────────────────────────────────────────
  '77001': ['Houston', 'TX'], '77002': ['Houston', 'TX'],
  '77006': ['Houston', 'TX'], '75201': ['Dallas', 'TX'],
  '75202': ['Dallas', 'TX'], '78701': ['Austin', 'TX'],
  '78704': ['Austin', 'TX'], '78201': ['San Antonio', 'TX'],
  '76101': ['Fort Worth', 'TX'], '79901': ['El Paso', 'TX'],
  '79401': ['Lubbock', 'TX'],
  // ── Utah ───────────────────────────────────────────────────────
  '84101': ['Salt Lake City', 'UT'], '84111': ['Salt Lake City', 'UT'],
  '84401': ['Ogden', 'UT'], '84601': ['Provo', 'UT'],
  // ── Vermont ────────────────────────────────────────────────────
  '05601': ['Montpelier', 'VT'], '05401': ['Burlington', 'VT'],
  // ── Virginia ───────────────────────────────────────────────────
  '23218': ['Richmond', 'VA'], '23510': ['Norfolk', 'VA'],
  '23601': ['Newport News', 'VA'], '22301': ['Alexandria', 'VA'],
  '22202': ['Arlington', 'VA'],
  // ── Washington ─────────────────────────────────────────────────
  '98101': ['Seattle', 'WA'], '98103': ['Seattle', 'WA'],
  '98109': ['Seattle', 'WA'], '98501': ['Olympia', 'WA'],
  '98402': ['Tacoma', 'WA'], '99201': ['Spokane', 'WA'],
  // ── West Virginia ──────────────────────────────────────────────
  '25301': ['Charleston', 'WV'], '26505': ['Morgantown', 'WV'],
  // ── Wisconsin ──────────────────────────────────────────────────
  '53202': ['Milwaukee', 'WI'], '53703': ['Madison', 'WI'],
  '54301': ['Green Bay', 'WI'],
  // ── Wyoming ────────────────────────────────────────────────────
  '82001': ['Cheyenne', 'WY'], '82601': ['Casper', 'WY'],
  // ── DC ─────────────────────────────────────────────────────────
  '20001': ['Washington', 'DC'], '20002': ['Washington', 'DC'],
  '20005': ['Washington', 'DC'],
};

/** Count of entries in the bundle. Used by tests and by an SP3
 *  Settings → Customer Directory "ZIP coverage" status line. */
export const US_ZIP_COUNT: number = Object.keys(ZIPS).length;

/** Returns true iff the input is exactly 5 digits (after trim).
 *  Whitespace allowed; ZIP+4 form '12345-6789' is rejected because
 *  v1's UI accepts the +4 separately if needed. */
export function isValidUsZip(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  return /^\d{5}$/.test(trimmed);
}

export interface ZipLookup {
  city: string;
  state: string;
}

/** Returns { city, state } for a known 5-digit US ZIP; null on miss. */
export function lookupZip(raw: unknown): ZipLookup | null {
  if (!isValidUsZip(raw)) return null;
  const key = (raw as string).trim();
  const hit = ZIPS[key];
  return hit ? { city: hit[0], state: hit[1] } : null;
}
