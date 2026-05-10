// US states + bundled top-cities dataset for the CityStateSelect component.
// Hybrid model: shipped data covers ~1,800 of the most populous US cities for
// instant offline autocomplete. When a user's city isn't in the list, they can
// still type it freely — the typed value is preserved on save.

export interface State {
  code: string;
  name: string;
}

export const US_STATES: State[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

// City list keyed by state code. Coverage: top ~30-50 cities per state by population,
// with heavier coverage for FL/CA/TX/NY/IL/PA/OH/GA where mobile-tire businesses cluster.
// Anything not in the list still works — the input accepts free-text entry.
export const CITIES_BY_STATE: Record<string, string[]> = {
  AL: ['Birmingham','Montgomery','Huntsville','Mobile','Tuscaloosa','Hoover','Auburn','Dothan','Madison','Decatur','Florence','Vestavia Hills','Phenix City','Prattville','Gadsden','Alabaster','Opelika','Northport','Enterprise','Daphne','Homewood','Bessemer','Athens'],
  AK: ['Anchorage','Fairbanks','Juneau','Wasilla','Sitka','Ketchikan','Kenai','Kodiak','Bethel','Palmer','Soldotna','Homer'],
  AZ: ['Phoenix','Tucson','Mesa','Chandler','Scottsdale','Glendale','Gilbert','Tempe','Peoria','Surprise','Yuma','Avondale','Goodyear','Flagstaff','Buckeye','Lake Havasu City','Casa Grande','Sierra Vista','Maricopa','Oro Valley','Prescott','Bullhead City','Apache Junction','Prescott Valley','Marana','El Mirage','Kingman','Queen Creek','Sahuarita','Sun City'],
  AR: ['Little Rock','Fort Smith','Fayetteville','Springdale','Jonesboro','North Little Rock','Conway','Rogers','Bentonville','Pine Bluff','Hot Springs','Benton','Texarkana','Sherwood','Jacksonville','Russellville','Bella Vista','West Memphis','Paragould','Cabot','Searcy','Van Buren','El Dorado','Maumelle'],
  CA: ['Los Angeles','San Diego','San Jose','San Francisco','Fresno','Sacramento','Long Beach','Oakland','Bakersfield','Anaheim','Stockton','Riverside','Santa Ana','Irvine','Chula Vista','Fremont','San Bernardino','Modesto','Fontana','Oxnard','Moreno Valley','Huntington Beach','Glendale','Santa Clarita','Garden Grove','Oceanside','Rancho Cucamonga','Santa Rosa','Ontario','Lancaster','Elk Grove','Corona','Palmdale','Salinas','Pomona','Hayward','Escondido','Torrance','Sunnyvale','Orange','Fullerton','Pasadena','Thousand Oaks','Visalia','Roseville','Concord','Simi Valley','East Los Angeles','Santa Clara','Vallejo','Berkeley','Victorville','El Monte','Downey','Costa Mesa','Inglewood','Carlsbad','Fairfield','Ventura','Temecula','Antioch','Richmond','West Covina','Murrieta','Norwalk','Daly City','Burbank','Santa Maria','El Cajon','Rialto','San Mateo','Compton','Clovis','Jurupa Valley','Vista','South Gate','Mission Viejo','Vacaville','Carson','Hesperia','Redding','Santa Monica','Westminster','Santa Barbara','Chico','Newport Beach','San Marcos','Whittier','Hawthorne','Citrus Heights','Tracy','Alhambra','Indio','Livermore','Buena Park','Lakewood','Merced','Hemet','Chino','Menifee','Lake Forest','Napa','Redwood City','Bellflower','Mountain View'],
  CO: ['Denver','Colorado Springs','Aurora','Fort Collins','Lakewood','Thornton','Arvada','Westminster','Pueblo','Centennial','Boulder','Greeley','Longmont','Loveland','Grand Junction','Broomfield','Castle Rock','Commerce City','Parker','Littleton','Northglenn','Brighton','Englewood','Wheat Ridge','Lafayette','Windsor','Erie','Evans','Golden','Louisville','Montrose','Durango'],
  CT: ['Bridgeport','New Haven','Hartford','Stamford','Waterbury','Norwalk','Danbury','New Britain','West Hartford','Greenwich','Hamden','Meriden','Bristol','Manchester','Fairfield','West Haven','Milford','Stratford','East Hartford','Middletown','Trumbull','Glastonbury','Naugatuck','Newington','Cheshire','Vernon','Windsor','New London','Branford','Wallingford'],
  DE: ['Wilmington','Dover','Newark','Middletown','Smyrna','Milford','Seaford','Georgetown','Elsmere','New Castle','Millsboro','Lewes','Rehoboth Beach','Bear','Bethany Beach'],
  DC: ['Washington'],
  FL: ['Jacksonville','Miami','Tampa','Orlando','St. Petersburg','Hialeah','Tallahassee','Port St. Lucie','Cape Coral','Fort Lauderdale','Pembroke Pines','Hollywood','Miramar','Gainesville','Coral Springs','Lehigh Acres','Palm Bay','West Palm Beach','Clearwater','Lakeland','Pompano Beach','Davie','Miami Gardens','Spring Hill','Brandon','Riverview','Sunrise','Plantation','Boca Raton','Deltona','Largo','Melbourne','Palm Coast','Deerfield Beach','Boynton Beach','Lauderhill','Fort Myers','Weston','Kissimmee','Homestead','Delray Beach','Tamarac','Daytona Beach','Wellington','North Port','Jupiter','Port Orange','Coconut Creek','Ocala','Sanford','Margate','Sarasota','Bradenton','Pensacola','Apopka','Bonita Springs','Pinellas Park','Doral','Coral Gables','North Miami','Aventura','Plant City','Greenacres','Ocoee','Titusville','Cutler Bay','Hallandale Beach','Oakland Park','Winter Garden','North Lauderdale','Royal Palm Beach','Pinecrest','Panama City','Riviera Beach','Estero','Land O Lakes','Wesley Chapel','Hialeah Gardens','North Miami Beach','Sunny Isles Beach','Parkland','Cooper City','Tarpon Springs','Miami Lakes','North Fort Myers','Fort Pierce','Winter Haven','Casselberry','Leesburg','Naples','Stuart','Punta Gorda','Vero Beach','New Smyrna Beach','DeLand','Miami Beach','Key West','Marathon','Southwest Ranches','Miami Shores','Davie','Pembroke Park','West Park','Lauderdale Lakes','Wilton Manors'],
  GA: ['Atlanta','Augusta','Columbus','Macon','Savannah','Athens','Sandy Springs','South Fulton','Roswell','Johns Creek','Albany','Warner Robins','Alpharetta','Marietta','Valdosta','Smyrna','Brookhaven','Dunwoody','Rome','East Point','Milton','Gainesville','Hinesville','Peachtree City','Newnan','Douglasville','Kennesaw','Lawrenceville','Statesboro','Tucker','Stockbridge','Carrollton','Decatur','Cumming','Acworth'],
  HI: ['Honolulu','East Honolulu','Pearl City','Hilo','Kailua','Waipahu','Kaneohe','Mililani','Kahului','Ewa Gentry','Mililani Mauka','Kihei','Makakilo','Wahiawa','Wailuku','Schofield Barracks','Kapolei','Lahaina','Kailua-Kona'],
  ID: ['Boise','Meridian','Nampa','Idaho Falls','Caldwell','Pocatello','Coeur dAlene','Twin Falls','Lewiston','Post Falls','Rexburg','Eagle','Moscow','Mountain Home','Kuna','Ammon','Chubbuck','Hayden','Garden City','Jerome'],
  IL: ['Chicago','Aurora','Joliet','Naperville','Rockford','Springfield','Elgin','Peoria','Champaign','Waukegan','Cicero','Bloomington','Arlington Heights','Evanston','Schaumburg','Bolingbrook','Decatur','Palatine','Skokie','Des Plaines','Orland Park','Tinley Park','Oak Lawn','Berwyn','Mount Prospect','Wheaton','Normal','Hoffman Estates','Oak Park','Downers Grove','Elmhurst','Glenview','DeKalb','Lombard','Belleville','Buffalo Grove','Crystal Lake','Romeoville','Plainfield','Carol Stream','Streamwood','Quincy','Bartlett','Carpentersville','Park Ridge','Urbana','Calumet City','Pekin'],
  IN: ['Indianapolis','Fort Wayne','Evansville','South Bend','Carmel','Fishers','Bloomington','Hammond','Gary','Lafayette','Muncie','Noblesville','Greenwood','Anderson','Elkhart','Mishawaka','Lawrence','Jeffersonville','Columbus','Portage','New Albany','Richmond','Westfield','Goshen','Valparaiso','Michigan City','Kokomo','Marion','Plainfield','Crown Point','Brownsburg','East Chicago','Granger','Schererville','Merrillville'],
  IA: ['Des Moines','Cedar Rapids','Davenport','Sioux City','Iowa City','Waterloo','Ames','West Des Moines','Council Bluffs','Dubuque','Ankeny','Urbandale','Cedar Falls','Marion','Bettendorf','Mason City','Marshalltown','Clinton','Burlington','Ottumwa','Fort Dodge','Muscatine','Coralville','Johnston','North Liberty','Altoona'],
  KS: ['Wichita','Overland Park','Kansas City','Olathe','Topeka','Lawrence','Shawnee','Manhattan','Lenexa','Salina','Hutchinson','Leavenworth','Leawood','Garden City','Junction City','Emporia','Derby','Prairie Village','Hays','Liberal','Pittsburg','Newton','Gardner','Great Bend','McPherson'],
  KY: ['Louisville','Lexington','Bowling Green','Owensboro','Covington','Hopkinsville','Richmond','Florence','Georgetown','Henderson','Elizabethtown','Nicholasville','Frankfort','Jeffersontown','Independence','Paducah','Radcliff','Ashland','Madisonville','Murray','Erlanger','Winchester','St. Matthews','Danville','Fort Thomas','Newport','Shively','Shelbyville'],
  LA: ['New Orleans','Baton Rouge','Shreveport','Lafayette','Lake Charles','Kenner','Bossier City','Monroe','Alexandria','Houma','Marrero','Laplace','New Iberia','Slidell','Prairieville','Central','Terrytown','Ruston','Sulphur','Hammond','Bayou Cane','Shenandoah','Natchitoches','Chalmette','Pineville','Zachary','Opelousas'],
  ME: ['Portland','Lewiston','Bangor','South Portland','Auburn','Biddeford','Sanford','Augusta','Saco','Westbrook','Waterville','Brunswick','Scarborough','Windham','Gorham','Falmouth','Bath','Cape Elizabeth','Yarmouth','Caribou','Topsham'],
  MD: ['Baltimore','Frederick','Rockville','Gaithersburg','Bowie','Hagerstown','Annapolis','College Park','Salisbury','Laurel','Greenbelt','Cumberland','Hyattsville','Westminster','Easton','Elkton','Ocean City','Cambridge','Bel Air','Aberdeen','Havre de Grace','Columbia','Silver Spring','Bethesda','Towson','Glen Burnie','Dundalk','Wheaton','Ellicott City','Germantown','Waldorf','Catonsville'],
  MA: ['Boston','Worcester','Springfield','Cambridge','Lowell','Brockton','New Bedford','Quincy','Lynn','Fall River','Newton','Lawrence','Somerville','Framingham','Haverhill','Waltham','Malden','Brookline','Plymouth','Medford','Taunton','Chicopee','Weymouth','Revere','Peabody','Methuen','Barnstable','Pittsfield','Attleboro','Arlington','Everett','Salem','Westfield','Leominster','Fitchburg','Beverly','Holyoke','Marlborough','Woburn','Amherst','Braintree','Shrewsbury','Chelsea','Dartmouth'],
  MI: ['Detroit','Grand Rapids','Warren','Sterling Heights','Ann Arbor','Lansing','Flint','Dearborn','Livonia','Troy','Westland','Farmington Hills','Kalamazoo','Wyoming','Southfield','Rochester Hills','Taylor','Pontiac','St. Clair Shores','Royal Oak','Novi','Dearborn Heights','Battle Creek','Saginaw','Kentwood','East Lansing','Roseville','Portage','Midland','Lincoln Park','Muskegon','Bay City','Jackson','Holland','Eastpointe','Burton','Madison Heights','Oak Park','Allen Park','Southgate','Marquette','Port Huron','Garden City','Inkster','Mount Pleasant','Wyandotte'],
  MN: ['Minneapolis','St. Paul','Rochester','Duluth','Bloomington','Brooklyn Park','Plymouth','Maple Grove','Woodbury','St. Cloud','Eagan','Eden Prairie','Coon Rapids','Burnsville','Blaine','Lakeville','Minnetonka','Apple Valley','Edina','St. Louis Park','Mankato','Maplewood','Moorhead','Shakopee','Cottage Grove','Richfield','Roseville','Inver Grove Heights','Andover','Brooklyn Center','Savage','Fridley','Oakdale','Chaska','Ramsey','Prior Lake','Shoreview','Winona','Chanhassen','Champlin','Elk River','Faribault','Rosemount','Hastings','Crystal'],
  MS: ['Jackson','Gulfport','Southaven','Hattiesburg','Biloxi','Olive Branch','Tupelo','Meridian','Greenville','Madison','Clinton','Pearl','Horn Lake','Oxford','Brandon','Starkville','Ridgeland','Columbus','Vicksburg','Pascagoula','Gautier','Laurel','Hernando','Long Beach','Natchez','Greenwood','Cleveland','Corinth','Ocean Springs'],
  MO: ['Kansas City','St. Louis','Springfield','Columbia','Independence','Lees Summit','OFallon','St. Joseph','St. Charles','Blue Springs','St. Peters','Florissant','Joplin','Wentzville','Chesterfield','Jefferson City','Cape Girardeau','Wildwood','University City','Ballwin','Raytown','Liberty','Kirkwood','Maryland Heights','Hazelwood','Gladstone','Grandview','Belton','Webster Groves','Sedalia','Arnold','Rolla','Warrensburg'],
  MT: ['Billings','Missoula','Great Falls','Bozeman','Butte','Helena','Kalispell','Havre','Anaconda','Miles City','Belgrade','Livingston','Laurel','Whitefish','Lewistown','Sidney','Glendive','Polson','Hamilton'],
  NE: ['Omaha','Lincoln','Bellevue','Grand Island','Kearney','Fremont','Hastings','Norfolk','North Platte','Columbus','Papillion','La Vista','Scottsbluff','South Sioux City','Beatrice','Lexington','Gering','Alliance'],
  NV: ['Las Vegas','Henderson','Reno','North Las Vegas','Sparks','Carson City','Fernley','Elko','Mesquite','Boulder City','Fallon','Winnemucca','West Wendover','Ely','Yerington'],
  NH: ['Manchester','Nashua','Concord','Derry','Dover','Rochester','Salem','Merrimack','Londonderry','Hudson','Bedford','Keene','Goffstown','Portsmouth','Laconia','Hampton','Milford','Durham','Exeter','Windham','Pelham','Hooksett'],
  NJ: ['Newark','Jersey City','Paterson','Elizabeth','Lakewood','Edison','Woodbridge','Toms River','Hamilton','Trenton','Clifton','Camden','Brick','Cherry Hill','Passaic','Middletown','Union City','Old Bridge','Gloucester','East Orange','Bayonne','Franklin','North Bergen','Vineland','Union','Piscataway','New Brunswick','Jackson','Wayne','Irvington','Parsippany-Troy Hills','Howell','Perth Amboy','Plainfield','East Brunswick','West New York','Bloomfield','West Orange','Evesham','Bridgewater','South Brunswick','Egg Harbor','Manchester','Hackensack','Sayreville','Mount Laurel','Berkeley','North Brunswick','Kearny','Linden','Marlboro','Galloway'],
  NM: ['Albuquerque','Las Cruces','Rio Rancho','Santa Fe','Roswell','Farmington','Clovis','Hobbs','Alamogordo','Carlsbad','Gallup','Deming','Los Lunas','Sunland Park','Las Vegas','Portales','Los Alamos','Artesia','Lovington','Silver City','Chaparral','Espanola'],
  NY: ['New York','Buffalo','Yonkers','Rochester','Syracuse','Albany','New Rochelle','Mount Vernon','Schenectady','Utica','White Plains','Hempstead','Troy','Niagara Falls','Binghamton','Freeport','Valley Stream','Long Beach','Spring Valley','Rome','Ithaca','Poughkeepsie','North Tonawanda','Jamestown','Kingston','Saratoga Springs','Watertown','Glen Cove','Newburgh','Middletown','Lockport','Auburn','Peekskill','Elmira','Lindenhurst','Ossining','Rockville Centre','Massapequa','Lynbrook','Cohoes','Cortland','Plattsburgh','Mineola','Floral Park','Garden City','Brentwood','Hicksville','Levittown','Coney Island','Astoria','Flushing','Jamaica','Brooklyn','Queens','Bronx','Staten Island','Manhattan'],
  NC: ['Charlotte','Raleigh','Greensboro','Durham','Winston-Salem','Fayetteville','Cary','Wilmington','High Point','Concord','Asheville','Greenville','Gastonia','Jacksonville','Chapel Hill','Rocky Mount','Huntersville','Burlington','Wilson','Kannapolis','Apex','Hickory','Wake Forest','Indian Trail','Mooresville','Goldsboro','Monroe','Salisbury','Holly Springs','Matthews','New Bern','Sanford','Cornelius','Garner','Thomasville','Fuquay-Varina','Asheboro','Statesville','Mint Hill','Kernersville','Morrisville','Lumberton','Carrboro','Havelock','Shelby','Clemmons','Lexington','Clayton','Boone','Elizabeth City'],
  ND: ['Fargo','Bismarck','Grand Forks','Minot','West Fargo','Mandan','Dickinson','Jamestown','Williston','Wahpeton','Devils Lake','Valley City','Grafton','Watford City','Beulah','Lincoln'],
  OH: ['Columbus','Cleveland','Cincinnati','Toledo','Akron','Dayton','Parma','Canton','Lorain','Hamilton','Youngstown','Springfield','Kettering','Elyria','Lakewood','Cuyahoga Falls','Middletown','Euclid','Mansfield','Newark','Mentor','Beavercreek','Cleveland Heights','Strongsville','Dublin','Fairfield','Findlay','Lancaster','Warren','Lima','Brunswick','Westerville','Upper Arlington','Stow','Gahanna','North Olmsted','Fairborn','Massillon','Westlake','North Royalton','Bowling Green','Garfield Heights','Shaker Heights','Mason','Reynoldsburg','Hilliard','Marion','Sandusky','Grove City'],
  OK: ['Oklahoma City','Tulsa','Norman','Broken Arrow','Edmond','Lawton','Moore','Midwest City','Enid','Stillwater','Muskogee','Bartlesville','Owasso','Shawnee','Yukon','Ardmore','Bixby','Ponca City','Duncan','Del City','Jenks','Sapulpa','Mustang','Bethany','Sand Springs','Altus','Claremore','El Reno','McAlester','Ada','Durant','Tahlequah','Chickasha'],
  OR: ['Portland','Salem','Eugene','Gresham','Hillsboro','Beaverton','Bend','Medford','Springfield','Corvallis','Albany','Tigard','Lake Oswego','Keizer','Grants Pass','Oregon City','McMinnville','Redmond','Tualatin','West Linn','Woodburn','Forest Grove','Newberg','Roseburg','Wilsonville','Klamath Falls','Ashland','Milwaukie','Sherwood','Hermiston','Central Point','Canby','Pendleton'],
  PA: ['Philadelphia','Pittsburgh','Allentown','Erie','Reading','Scranton','Bethlehem','Lancaster','Harrisburg','York','Altoona','Wilkes-Barre','Chester','Williamsport','Easton','Lebanon','Hazleton','New Castle','Johnstown','McKeesport','Hermitage','Norristown','Pottstown','Plum','State College','West Chester','West Mifflin','Carlisle','Penn Hills','Pottsville','Hanover','Phoenixville','Indiana','Greensburg','Sharon','Dunmore','Doylestown','Chambersburg','Lansdale','Murrysville','Drexel Hill','Levittown','King of Prussia','Reading','Bensalem','Bristol','Lower Merion'],
  RI: ['Providence','Warwick','Cranston','Pawtucket','East Providence','Woonsocket','Coventry','North Providence','Cumberland','West Warwick','Johnston','North Kingstown','South Kingstown','Newport','Bristol','Westerly','Lincoln','Smithfield','Central Falls','Portsmouth','Tiverton','Barrington'],
  SC: ['Columbia','Charleston','North Charleston','Mount Pleasant','Rock Hill','Greenville','Summerville','Sumter','Goose Creek','Hilton Head Island','Florence','Spartanburg','Myrtle Beach','Aiken','Anderson','Greer','Mauldin','Greenwood','North Augusta','Easley','Simpsonville','Hanahan','Lexington','Conway','West Columbia','North Myrtle Beach','Clemson','Orangeburg','Cayce','Bluffton','Beaufort'],
  SD: ['Sioux Falls','Rapid City','Aberdeen','Brookings','Watertown','Mitchell','Yankton','Pierre','Huron','Vermillion','Spearfish','Brandon','Madison','Sturgis','Belle Fourche'],
  TN: ['Nashville','Memphis','Knoxville','Chattanooga','Clarksville','Murfreesboro','Franklin','Jackson','Johnson City','Bartlett','Hendersonville','Kingsport','Smyrna','Collierville','Cleveland','Brentwood','Germantown','Columbia','La Vergne','Cookeville','Spring Hill','Mount Juliet','Gallatin','Lebanon','Morristown','Oak Ridge','Maryville','Bristol','Farragut','Shelbyville'],
  TX: ['Houston','San Antonio','Dallas','Austin','Fort Worth','El Paso','Arlington','Corpus Christi','Plano','Lubbock','Laredo','Irving','Garland','Frisco','McKinney','Amarillo','Grand Prairie','Brownsville','Pasadena','Mesquite','McAllen','Killeen','Carrollton','Midland','Waco','Denton','Round Rock','Lewisville','Abilene','Pearland','Odessa','Beaumont','Richardson','College Station','Wichita Falls','Tyler','Sugar Land','League City','Allen','San Angelo','Edinburg','Mission','Longview','Bryan','Pharr','Baytown','Missouri City','Temple','Flower Mound','New Braunfels','North Richland Hills','Conroe','Cedar Park','Atascocita','Mansfield','Victoria','Rowlett','Pflugerville','Georgetown','Port Arthur','Euless','DeSoto','Galveston','Grapevine','Bedford','Cedar Hill','Wylie','Keller','Coppell','Hurst','Texarkana','Lancaster','Friendswood','Spring','Harlingen','The Woodlands','Burleson','Rockwall','Sherman','Schertz','Leander','Little Elm','Texas City','Haltom City','Huntsville','Duncanville','San Marcos','Weslaco'],
  UT: ['Salt Lake City','West Valley City','West Jordan','Provo','Orem','Sandy','Ogden','St. George','Layton','South Jordan','Lehi','Millcreek','Taylorsville','Logan','Murray','Draper','Bountiful','Riverton','Herriman','Spanish Fork','Roy','Pleasant Grove','Tooele','Cedar City','Springville','Cottonwood Heights','Kaysville','Holladay','American Fork','Clearfield','Syracuse','Saratoga Springs','Washington','Eagle Mountain'],
  VT: ['Burlington','South Burlington','Rutland','Essex','Colchester','Bennington','Brattleboro','Hartford','Milton','Williston','Barre','Springfield','Middlebury','Montpelier','Winooski','St. Albans','Newport','Vergennes'],
  VA: ['Virginia Beach','Norfolk','Chesapeake','Richmond','Newport News','Alexandria','Hampton','Roanoke','Portsmouth','Suffolk','Lynchburg','Harrisonburg','Leesburg','Charlottesville','Danville','Manassas','Petersburg','Fredericksburg','Winchester','Salem','Staunton','Hopewell','Fairfax','Waynesboro','Herndon','Vienna','Bristol','Front Royal','Falls Church','Williamsburg','Martinsville','Radford','Culpeper','Christiansburg','Blacksburg'],
  WA: ['Seattle','Spokane','Tacoma','Vancouver','Bellevue','Kent','Everett','Renton','Spokane Valley','Federal Way','Yakima','Bellingham','Kennewick','Kirkland','Auburn','Pasco','Marysville','Lakewood','Redmond','Sammamish','Shoreline','Olympia','Richland','Lacey','Burien','Bothell','Edmonds','Puyallup','Bremerton','Wenatchee','Mount Vernon','University Place','Walla Walla','Pullman','Lynnwood','Mercer Island','Maple Valley','Issaquah','Des Moines','Mukilteo','Tukwila','Tumwater','SeaTac','Camas','Lake Stevens','Bonney Lake','Mill Creek','Oak Harbor'],
  WV: ['Charleston','Huntington','Morgantown','Parkersburg','Wheeling','Weirton','Fairmont','Martinsburg','Beckley','Clarksburg','Lewisburg','South Charleston','Teays Valley','St. Albans','Vienna','Bluefield','Cross Lanes','Princeton','Hurricane','Bridgeport','Charles Town','Keyser','New Martinsville','Buckhannon','Dunbar','Elkins','Nitro','Oak Hill'],
  WI: ['Milwaukee','Madison','Green Bay','Kenosha','Racine','Appleton','Waukesha','Oshkosh','Eau Claire','Janesville','West Allis','La Crosse','Sheboygan','Wauwatosa','Fond du Lac','New Berlin','Brookfield','Beloit','Greenfield','Manitowoc','Franklin','Oak Creek','West Bend','Sun Prairie','Wausau','Superior','Stevens Point','Neenah','Fitchburg','Muskego','Mequon','South Milwaukee','De Pere','Watertown','Marshfield','Cudahy','Pleasant Prairie','Onalaska','Menomonie','River Falls'],
  WY: ['Cheyenne','Casper','Laramie','Gillette','Rock Springs','Sheridan','Green River','Evanston','Riverton','Jackson','Cody','Rawlins','Lander','Powell','Douglas','Worland','Torrington','Buffalo','Wheatland'],
};

export function citiesForState(stateCode: string): string[] {
  return CITIES_BY_STATE[stateCode] || [];
}

export function searchCities(stateCode: string, query: string, limit = 8): string[] {
  if (!stateCode) return [];
  const q = query.trim().toLowerCase();
  const all = citiesForState(stateCode);
  if (!q) return all.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const c of all) {
    const lc = c.toLowerCase();
    if (lc.startsWith(q)) starts.push(c);
    else if (lc.includes(q)) contains.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function stateName(code: string): string {
  return US_STATES.find((s) => s.code === code)?.name || code;
}

export function fullLocationLabel(city: string, stateCode: string): string {
  if (city && stateCode) return `${city}, ${stateCode}`;
  return city || stateCode || '';
}
