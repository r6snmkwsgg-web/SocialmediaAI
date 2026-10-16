/**
 * What a rivalry can't be about: who people are. A side named for a
 * country or its people, a race or ethnicity, a religion, its figures,
 * gods or books, or who people love or what gender they are, sets the
 * chat on each other, and TikTok's rules on hate protect exactly those
 * things. This reads a side's name the way people type it ("USA", "Team
 * Israel", "the Jews", "Musl1ms", "ɪɴᴅɪᴀ") and says whether it names people.
 *
 * Words are matched whole, so "Real Madrid" and "Atlético" are fine while
 * "Mexico" isn't. A few words name people only sometimes ("Black Ops" is
 * a game, "Black vs White" isn't), and a few countries share their name
 * with everyday things (Jordan, Turkey, Georgia); those count only next to
 * a word like "people", or against a side that's the same kind of word.
 *
 * It reads English best. Every country's name is also checked in the big
 * languages of TikTok LIVE that use the same letters, and in its own, and
 * the words for peoples, faiths, race and who people love in Spanish,
 * Portuguese and French. Other languages' words for those aren't, yet.
 */

/**
 * Every country, by the names people use for it and for the people from
 * it. Countries whose name is mostly something else are under MAYBE.
 */
const COUNTRIES = [
  "afghanistan|afghan|afghani",
  "albania|albanian",
  "algeria|algerian",
  "andorra|andorran",
  "angola|angolan",
  "antigua|barbuda|antiguan|barbudan",
  "argentina|argentine|argentinian|argentinean",
  "armenia|armenian",
  "australia|australian|aussie",
  "austria|austrian",
  "azerbaijan|azerbaijani|azeri",
  "bahamas|bahamian",
  "bahrain|bahraini",
  "bangladesh|bangladeshi",
  "barbados|barbadian|bajan",
  "belarus|belarusian|byelorussian",
  "belgium|belgian",
  "belize|belizean",
  "benin|beninese",
  "bhutan|bhutanese",
  "bolivia|bolivian",
  "bosnia|herzegovina|bosnian|bosniak|herzegovinian",
  "botswana|botswanan|motswana|batswana",
  "brazil|brasil|brazilian",
  "brunei|bruneian",
  "bulgaria|bulgarian",
  "burkina faso|burkina|burkinabe",
  "burundi|burundian",
  "cambodia|cambodian|khmer",
  "cameroon|cameroonian",
  "canada|canadian",
  "cape verde|cabo verde|cape verdean",
  "central african republic|central african",
  "chadian",
  "chilean",
  "china|prc|chinese",
  "colombia|colombian",
  "comoros|comorian",
  "congo|dr congo|drc|congolese|zaire",
  "costa rica|costa rican",
  "croatia|croatian|croat",
  "cuba|cuban",
  "cyprus|cypriot",
  "czechia|czech republic|czech|czechoslovakia",
  "denmark|danish|danes",
  "djibouti|djiboutian",
  "dominica|dominican republic|dominican",
  "ecuador|ecuadorian|ecuadorean",
  "egypt|egyptian",
  "el salvador|salvadoran|salvadorian|salvadorean",
  "equatorial guinea|equatoguinean|equatorial guinean",
  "eritrea|eritrean",
  "estonia|estonian",
  "eswatini|swaziland|swazi",
  "ethiopia|ethiopian|abyssinia",
  "fijian",
  "finland|finnish|finns",
  "france|french",
  "gabon|gabonese",
  "gambia|gambian",
  "germany|deutschland|german",
  "ghana|ghanaian",
  "greece|hellas|greek",
  "grenada|grenadian",
  "guatemala|guatemalan",
  "guinean",
  "guinea bissau|bissau guinean",
  "guyana|guyanese",
  "haiti|haitian",
  "honduras|honduran",
  "hungary|hungarian|magyar",
  "iceland|icelandic|icelander",
  "india|bharat|hindustan|indian",
  "indonesia|indonesian",
  "iran|persia|iranian|persian",
  "iraq|iraqi",
  "ireland|eire|irish",
  "israel|israeli|israelite",
  "italy|italia|italian",
  "ivory coast|cote divoire|ivorian",
  "jamaica|jamaican",
  "japan|nippon|japanese",
  "jordanian",
  "kazakhstan|kazakh|kazakhstani",
  "kenya|kenyan",
  "kiribati|i kiribati",
  "kuwait|kuwaiti",
  "kyrgyzstan|kyrgyz",
  "laos|lao|laotian",
  "latvia|latvian",
  "lebanon|lebanese",
  "lesotho|basotho|mosotho",
  "liberia|liberian",
  "libya|libyan",
  "liechtenstein|liechtensteiner",
  "lithuania|lithuanian",
  "luxembourg|luxembourger|luxembourgish",
  "madagascar|malagasy|madagascan",
  "malawi|malawian",
  "malaysia|malaysian|malay",
  "maldives|maldivian",
  "mali|malian",
  "malta|maltese",
  "marshall islands|marshallese",
  "mauritania|mauritanian",
  "mauritius|mauritian",
  "mexico|mexican",
  "micronesia|micronesian",
  "moldova|moldovan",
  "monegasque",
  "mongolia|mongolian|mongol",
  "montenegro|montenegrin",
  "morocco|moroccan",
  "mozambique|mozambican",
  "myanmar|burma|burmese",
  "namibia|namibian",
  "nauru|nauruan",
  "nepal|nepali|nepalese",
  "netherlands|nederland|dutch",
  "new zealand|nz|new zealander",
  "nicaragua|nicaraguan",
  "niger|nigerien",
  "nigeria|naija|nigerian",
  "north korea|dprk|north korean",
  "north macedonia|macedonia|macedonian",
  "norway|norwegian",
  "oman|omani",
  "pakistan|pakistani|paki",
  "palau|palauan",
  "panamanian",
  "papua new guinea|papua|papuan|papua new guinean",
  "paraguay|paraguayan",
  "peru|peruvian",
  "philippines|philippine|filipino|filipina|pinoy|pinay",
  "poland|poles",
  "portugal|portuguese",
  "qatar|qatari",
  "romania|rumania|romanian",
  "russia|rossiya|russian",
  "rwanda|rwandan",
  "samoa|samoan",
  "san marino|sammarinese",
  "saudi arabia|saudi|ksa",
  "senegal|senegalese",
  "serbia|serbian|serb",
  "seychelles|seychellois",
  "sierra leone|sierra leonean",
  "singapore|singaporean",
  "slovakia|slovak|slovakian",
  "slovenia|slovenian|slovene",
  "solomon islands|solomon islander",
  "somalia|somaliland|somali|somalian",
  "south africa|south african",
  "south korea|korea|korean",
  "south sudan|south sudanese",
  "spain|espana|spanish|spaniard",
  "sri lanka|lanka|ceylon|sri lankan|sinhalese|sinhala",
  "st kitts|saint kitts|kitts|nevis|kittitian|nevisian",
  "st lucia|saint lucia|st lucian|saint lucian",
  "st vincent|saint vincent|grenadines|vincentian",
  "sudan|sudanese",
  "suriname|surinam|surinamese",
  "sweden|swedish|swedes",
  "switzerland|swiss",
  "syria|syrian",
  "sao tome|principe|santomean",
  "taiwan|formosa|taiwanese",
  "tajikistan|tajik|tajikistani",
  "tanzania|zanzibar|tanzanian",
  "thailand|siam|thai",
  "timor leste|east timor|timor|timorese",
  "togo|togolese",
  "tonga|tongan",
  "trinidad|tobago|trinidadian|tobagonian|trini",
  "tunisia|tunisian",
  "turkiye|turkish|turk",
  "turkmenistan|turkmen",
  "tuvalu|tuvaluan",
  "uae|united arab emirates|emirati",
  "uk|united kingdom|britain|great britain|british|brit|briton|england|english|scotland|scottish|scots|wales|welsh|northern ireland",
  "usa|united states|united states of america|american|merica",
  "uganda|ugandan",
  "ukraine|ukrainian",
  "uruguay|uruguayan",
  "uzbekistan|uzbek",
  "vanuatu|ni vanuatu",
  "vatican|vatican city|holy see",
  "venezuela|venezuelan",
  "vietnam|viet nam|vietnamese|viet",
  "yemen|yemeni|yemenite",
  "zambia|zambian",
  "zimbabwe|rhodesia|zimbabwean",
  // places people fight over, and countries that were
  "palestine|palestinian|gaza|west bank",
  "kosovo|kosovar|kosovan",
  "tibet|tibetan",
  "hong kong|hongkonger|macau",
  "puerto rico|puerto rican|boricua",
  "greenland|greenlandic",
  "kurdistan|kurd|kurdish",
  "catalonia|catalan|basque",
  "chechnya|chechen|crimea|crimean|donbas|kashmir|kashmiri|punjab|punjabi",
  "western sahara|sahrawi",
  "soviet|soviet union|ussr|yugoslavia|yugoslav",
  "falklands|malvinas|gibraltar",
];

/** England, Scotland and Wales, and Britain and the US, as other languages name them: they have no country code to look up */
const HOME_NATIONS = [
  "inglaterra|escocia|angleterre|ecosse|pays de galles|pais de gales|inghilterra|scozia|schottland|engeland|schotland|szkocja|walia|iskocya|ingiltere",
  "gran bretana|gra bretanha|grande bretagne|gran bretagna|grossbritannien|eeuu|ee uu|eua",
];

/** where people are from, by continent or region, and race and ethnicity */
const PEOPLES = [
  "africa|african|europe|european|asia|asian|oriental|latin america|latin american|south america|south american",
  "north america|north american|middle east|middle eastern|arab|arabic|arabia|scandinavia|scandinavian|balkans|balkan|caribbean",
  "polynesian|melanesian|pacific islander|slav|slavic|anglo|anglo saxon|westerner|gringo|gringa",
  "latino|latina|latinx|latine|hispanic|chicano|chicana|caucasian|eskimo|inuit|maori|aboriginal|aborigine|indigenous|native american|first nations",
  "tamil|pashtun|baloch|hazara|uyghur|uighur|han chinese|tatar|amazigh|tuareg|zulu|xhosa|yoruba|igbo|hausa|fulani|amhara|oromo|tigrayan",
  "tutsi|hutu|maasai|hmong|rohingya|druze|assyrian|copt|coptic|romani|gypsy|gypsies|mestizo|mulatto|biracial|mixed race|people of color|poc|bipoc",
  "brahmin|dalit|caste|ashkenazi|sephardi|sephardic|mizrahi",
  "blacks|whites|black people|white people|brown people|black lives|white power",
  // people named for having come from somewhere else
  "immigrant|immigrants|migrant|migrants|emigrant|emigrants|illegals|illegal immigrant|illegal alien|foreigners|refugee|refugees|asylum seeker|expat|expats",
];

/** religions, their people and places of worship, their figures and gods, and their books */
const FAITHS = [
  "religion|religious|christianity|christendom|catholic|catholicism|protestant|protestantism|orthodox|evangelical|baptist|methodist",
  "lutheran|anglican|presbyterian|pentecostal|mormon|mormonism|lds|latter day saints|jehovahs witness|quaker|amish|adventist|calvinist",
  "church|mosque|synagogue|gurdwara|islam|islamic|muslim|moslem|sunni|shiite|sufi|ahmadi|ismaili|salafi|wahhabi|jihad|jihadi|jihadist",
  "infidel|kafir|judaism|jew|jewish|hasidic|zionist|zionism|goy|goyim|hindu|hinduism|hindutva|buddhist|buddhism|sikh|sikhism",
  "jainism|taoist|taoism|shinto|confucian|zoroastrian|bahai|wicca|wiccan|pagan|paganism|satanist|satanism|scientology|scientologist",
  "rastafari|rastafarian|atheist|atheism|agnostic|godless",
  "allah|yahweh|yahve|yahveh|jehovah|christ|jesus christ|messiah|holy spirit|virgin mary|prophet|buddha|siddhartha|hanuman|ganesha|guru nanak",
  "dalai lama|ayatollah|son of god",
  "bible|biblical|quran|koran|torah|talmud|tanakh|old testament|new testament|hadith|sharia|bhagavad gita|vedas|upanishads",
  "tripitaka|book of mormon|guru granth sahib|granth",
];

/** who people love, and gender identity */
const LOVE = [
  "gay|lesbian|bisexual|homosexual|heterosexual|hetero|queer|lgbt|lgbtq|lgbtqia|lgbtqi|glbt|transgender|transsexual|tranny|nonbinary|non binary",
  "enby|genderqueer|genderfluid|gender fluid|agender|cis|cisgender|intersex|asexual|pansexual|aromantic|two spirit|straights",
];

/** groups that exist to set people against each other, and armies at war */
const HATE = ["nazi|neo nazi|kkk|klan|ku klux klan|isis|isil|taliban|al qaeda|hamas|hezbollah|idf"];

/**
 * Slurs for race, religion, where people are from and who they love, in
 * English, Spanish, Portuguese and French. They're written in ROT13 (each
 * letter 13 along) so this file doesn't read as a list of them; `rot13`
 * turns them back.
 */
const SLURS = [
  "avttre|avttn|avttnm|artebrf|fcvp|fcvpx|jrgonpx|ornare|puvax|tbbx|wnc|mvccreurnq|puvat pubat|fynagrlr|fynag rlr|enturnq|gbjryurnq|fnaq avttre|pnzry wbpxrl",
  "xvxr|lvq|ulzvr|urro|xenhg|jbc|qntb|cbynpx|yvzrl|ubaxl|ubaxrl|juvgrl|erqfxva|vawha|fdhnj|nob|pbbyvr|qnexvr|qnexl|tbyyvjbt|jbt|wvtnobb",
  "cbepu zbaxrl|whatyr ohaal|gne onol|cvxrl|tlccb|xnssve|zhmmvr|unysoerrq|unys oerrq|fuvxfn|puevfg xvyyre|cncvfg",
  "snt|snttbg|sntbg|qlxr|ohyyqlxr|ubzb|cbbs|cbbsgre|yrfob|yrmmvr|yrmml|furznyr|ynqlobl|fbqbzvgr|onggl obl|ongglzna|shqtr cnpxre|shqtrcnpxre",
  "fhqnpn|artengn|znevpba|znevpn|wbgb|chgb|ivnqb|onvgbyn|fncngnb|crqr|gncrggr|tbhvar|gneybhmr|obhtabhyr|lbhcva|ovpbg|arter",
];

/** a letter 13 along the alphabet, which undoes itself */
export const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

/**
 * A Spanish or Portuguese word for people, with its other endings: "ruso"
 * is also rusa, rusos and rusas, "francés" francesa and franceses, and
 * "alemão" alemã and alemães.
 */
function iberian(word: string): string[] {
  const w = fold(word).toLowerCase();
  const stem = (n: number) => w.slice(0, w.length - n);
  if (w.endsWith("ao")) return [w, `${stem(2)}a`, `${stem(2)}aes`, `${stem(2)}aos`, `${stem(2)}as`];
  if (w.endsWith("o")) return [w, `${stem(1)}a`, `${stem(1)}os`, `${stem(1)}as`];
  if (w.endsWith("eu") || w.endsWith("e") || w.endsWith("a") || w.endsWith("i") || w.endsWith("u")) return [w, `${w}s`, `${w}es`];
  if (w.endsWith("l")) return [w, `${w}a`, `${w}es`, `${w}as`, `${stem(1)}is`];
  return [w, `${w}a`, `${w}es`, `${w}as`];
}

/** A French word for people, with its other endings: "algérien" is also algérienne, algériens and algériennes. */
function french(word: string): string[] {
  const w = fold(word).toLowerCase();
  if (w.endsWith("en")) return [w, `${w}ne`, `${w}s`, `${w}nes`];
  if (w.endsWith("e")) return [w, `${w}s`];
  if (w.endsWith("s") || w.endsWith("x")) return [w, `${w}e`, `${w}es`];
  return [w, `${w}e`, `${w}s`, `${w}es`];
}

const spaced = (s: string) => s.split(" ");

/**
 * Spanish, Portuguese and French: the words for the people of the
 * countries LIVEs in those languages argue about most, and for peoples,
 * faiths and who people love. A few that are also everyday words or names
 * are left out or only plural: "cristiano" (Cristiano Ronaldo), "checo"
 * (Checo Pérez), "indiana" (the state).
 */
const otherTongues = () => [
  ...spaced(
    "estadounidense norteamericano mexicano guatemalteco hondureño salvadoreño nicaragüense costarricense panameño cubano dominicano haitiano puertorriqueño jamaiquino " +
      "venezolano colombiano ecuatoriano peruano boliviano chileno argentino uruguayo paraguayo brasileño canadiense español portugués francés inglés británico escocés " +
      "irlandés alemán italiano holandés neerlandés belga suizo austriaco sueco noruego danés finlandés polaco eslovaco húngaro rumano búlgaro griego turco ruso ucraniano " +
      "bielorruso serbio croata bosnio albanés kosovar armenio georgiano azerí israelí israelita palestino árabe sirio libanés jordano iraquí iraní persa afgano pakistaní indio " +
      "bangladesí chino japonés coreano vietnamita tailandés filipino indonesio malayo australiano egipcio marroquí argelino tunecino libio saudí nigeriano ghanés senegalés " +
      "keniano etíope somalí sudafricano congoleño angoleño camerunés marfileño africano europeo asiático latinoamericano sudamericano centroamericano caribeño extranjero " +
      "inmigrante migrante gitano mulato indígena afrodescendiente afroamericano musulmán islámico islamista católico evangélico protestante ortodoxo judío hebreo ateo budista " +
      "hindú mormón sij lesbiana homosexual heterosexual bisexual transexual travesti",
  ).flatMap(iberian),
  ...spaced(
    "brasileiro português espanhol francês inglês britânico alemão italiano holandês suíço norueguês polonês grego russo ucraniano israelense palestino iraniano iraquiano " +
      "sírio libanês egípcio marroquino argelino nigeriano angolano moçambicano caboverdiano africano asiático chinês japonês coreano paquistanês uruguaio estrangeiro " +
      "imigrante cigano mestiço indígena índio muçulmano islâmico cristão católico evangélico crente judeu ateu lésbica homossexual heterossexual bissexual",
  ).flatMap(iberian),
  ...spaced(
    "américain mexicain canadien brésilien argentin colombien vénézuélien péruvien chilien cubain haïtien français anglais britannique écossais gallois irlandais allemand " +
      "italien espagnol portugais belge suisse néerlandais hollandais suédois norvégien danois finlandais polonais tchèque hongrois roumain bulgare russe ukrainien serbe " +
      "croate bosniaque albanais arménien géorgien israélien palestinien arabe syrien libanais irakien iranien afghan pakistanais indien chinois japonais coréen vietnamien " +
      "thaïlandais philippin indonésien australien égyptien marocain algérien tunisien libyen sénégalais malien ivoirien camerounais congolais nigérian ghanéen éthiopien " +
      "somalien kényan africain européen asiatique maghrébin étranger immigré migrant gitan manouche métis musulman islamique islamiste chrétien catholique protestant " +
      "évangélique athée bouddhiste hindou lesbienne homosexuel hétérosexuel bisexuel transsexuel",
  ).flatMap(french),
  // the ones whose other endings don't follow the rules, and words that come in one form
  "cristianos|cristiana|cristianas|checos|checa|checas|indianos|indianas|europeia|europeias|judia|judias|ateia|ateias|juive|juives|turque|turques|grecque|grecques",
  "cristianismo|catolicismo|judaismo|ateismo|budismo|hinduismo|islamismo|iglesia|igreja|eglise|mezquita|mesquita|mosquee|sinagoga|biblia|bibbia|bibel|coran|alcoran|alcorao|corao|corano",
  "mahoma|maome|mahomet|jehova|moro|moros|sudafrica|beur|beurs|rebeu|rebeus|renoi|renois|babtou|babtous|toubab|toubabs|feuj|feujs|lesbica|lesbicas",
  "metisse|metisses|immigree|immigrees|homosexuelle|homosexuelles|heterosexuelle|heterosexuelles|bisexuelle|bisexuelles|transsexuelle|transsexuelles",
];

/**
 * Words that name people only when they're all a side says ("Women",
 * "Team Jesus", "Trans people"): "Man United", "Gabriel Jesus" and "God of
 * War" are fine.
 */
const ALONE = [
  "man|men|woman|women|boy|boys|girl|girls|guys|gals|ladies|gentlemen|male|males|female|females|dudes|husbands|wives|trans|bi",
  "god|gods|jesus|muhammad|mohammed|mohammad|mohamed|muhammed|moses|krishna|vishnu|shiva|ganesh|rama|brahma|durga|lakshmi|mahdi|zion",
  "pope|rabbi|imam|gospel|christian|shia|jain|parsi|gita|veda|desi|afro|berber|native|natives|coon|coons",
  // in Spanish, Portuguese and French: men and women, boys and girls, and God, Christ, the Torah and Buddha
  "hombre|hombres|mujer|mujeres|ninos|ninas|chicos|chicas|homem|homens|mulher|mulheres|meninos|meninas|garotos|garotas|homme|hommes|femme|femmes|garcons|filles",
  "dios|deus|dieu|cristo|tora|buda",
];

/** colours and words that name people next to "people" or each other ("Black vs White"), and not otherwise ("Black Ops", "White Sox", "Straight vs Curly", "Rojo vs Negro") */
const CONTEXT = [
  "black|white|brown|straight",
  "negro|negros|negra|negras|blanco|blancos|blanca|blancas|moreno|morenos|morena|morenas|preto|pretos|preta|pretas|branco|brancos|branca|brancas|pardo|pardos",
  "noir|noirs|noire|noires|blanc|blancs|blanche|blanches",
];

/** countries that share their name with everyday things, and so count only against another place: "LeBron vs Jordan" is fine, "Georgia vs Turkey" isn't */
const MAYBE = [
  "jordan|georgia|georgian|chad|turkey|jersey|guinea|monaco|panama|chile|fiji|bermuda|holland|roma|kiwi|emirates|polish",
  // America, for Club América; "USA" and "American" still count
  "america",
  // other languages' words for countries and their people that are also English words, clubs or names: Granada, the club; Island, Iceland in
  // German; the Montreal Canadiens; an Americano
  "americano|americanos|americana|americanas|canadien|canadiens|canadienne|canadiennes|gales|granada|grenade|island|indie|suede|chili|maurice",
  "salvador|columbia|dominique|franca|catar|malte|turki|cipro|gana|anglia|polonia|polen|cypr|guine|guinee|gine|gwinea|guineea",
];

/** everyday things named after a people, read as the thing: "French Fries vs Tots" is about food */
const EVERYDAY = [
  "french fries", "french fry", "french toast", "french bulldog", "french press", "swiss cheese", "swiss roll", "danish pastry",
  "english muffin", "american football", "irish coffee", "turkish delight", "greek yogurt", "german shepherd", "great dane", "brazil nut",
  "afghan hound", "all blacks", "all whites",
];

/** words that say nothing about who a side is: dropped before a side is read for ALONE, CONTEXT and MAYBE words */
const FILLER = new Set(
  "a an the all our my your we are of and or for in is i love go team side squad crew gang club fan fans army nation real true only lord holy saint st almighty great king son".split(" "),
);
/** words that turn a colour into people: "Black people", "White power" */
const PEOPLE = new Set("people folks lives community culture power pride".split(" "));
/** what people put on either end of a name run together: "teamisrael", "israelfans" */
const BEFORE = "team go the all our my we love real true only pro anti fan fans club army nation gang squad crew".split(" ");
const AFTER = "team fans fan army nation gang squad crew club side pride power people lives".split(" ");

/** the two-letter codes of every country and the places COUNTRIES lists, to look up what other languages call them */
const CODES = (
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET " +
  "FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN " +
  "ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG " +
  "TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW PS XK TW HK MO PR GL EH"
).split(" ");
/** languages besides English that are big on TikTok LIVE and use the same letters; every country's own language is read too */
const LANGUAGES = ["es", "pt", "fr", "de", "it", "nl", "pl", "tr", "id", "ro"];

/**
 * Every country's name in those languages and its own ("Alemania",
 * "Rusya", "Polska", "Sverige"), from the names the browser or server
 * already knows. Names under four letters are left out, since short
 * words in one language are everyday ones in another.
 */
function countriesAbroad(): string[] {
  const out = new Set<string>();
  try {
    const shown = new Map<string, Intl.DisplayNames>();
    const namer = (lang: string) => {
      let d = shown.get(lang);
      if (!d) shown.set(lang, (d = new Intl.DisplayNames([lang], { type: "region", fallback: "none" })));
      return d;
    };
    for (const code of CODES) {
      const own = new Intl.Locale(`und-${code}`).maximize().language;
      for (const lang of [...LANGUAGES, own]) {
        const name = namer(lang).of(code);
        if (!name || !plainLetters(name)) continue;
        const w = words(name).join(" ");
        if (w.replace(/ /g, "").length >= 4) out.add(w);
      }
    }
  } catch {
    // somewhere without these names: the English ones still stand
  }
  return [...out];
}

/** Letters that look like a to z but don't come apart into one: small capitals from "fancy text" generators, and the European letters that aren't an accent on one. */
const LOOKALIKES: Record<string, string> = {
  "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f", "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m",
  "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ꞯ": "q", "ʀ": "r", "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z",
  "ı": "i", "ȷ": "j", "ß": "ss", "ẞ": "ss", "ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ł": "l", "Ł": "l",
  "đ": "d", "Đ": "d", "ð": "d", "Ð": "d", "þ": "th", "Þ": "th", "ħ": "h", "Ħ": "h", "ŧ": "t", "Ŧ": "t", "ŋ": "n", "Ŋ": "n",
  "ɑ": "a", "ɡ": "g", "ɛ": "e", "ɔ": "o", "ɩ": "i", "ĸ": "k", "ƒ": "f", "ɨ": "i", "ʉ": "u",
};

/** a name with accents off and look-alike letters read as the a to z they look like: "Atlético" is Atletico, "ɪɴᴅɪᴀ" is india */
function fold(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\u0000-\u007f]/gu, (c) => LOOKALIKES[c] ?? c);
}

/**
 * The letters a side's name can use while there's no check for other
 * alphabets: Latin letters, accented ones included, digits, spaces and
 * everyday punctuation, and every letter has to come down to one of a to
 * z, so look-alikes can't pass as blanks. Names in Arabic, Hindi or
 * Cyrillic, emoji (flags among them), and letters like ʘ aren't allowed
 * until something can read them.
 */
export function plainLetters(name: string): boolean {
  if (!/^[\p{Script=Latin}\p{M}0-9 .,'’"&!?:;()/+#*@$-]*$/u.test(name)) return false;
  return !/\p{L}/u.test(fold(name).replace(/[a-z]/gi, ""));
}

/** a name as words: split where case changes ("TeamIsrael"), accents off, look-alikes read as letters, apostrophes gone, anything else a space */
function words(name: string): string[] {
  return fold(name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"))
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

/** the same name with numbers and symbols read as the letters they stand in for: "Musl1ms", "J3ws" */
const unleet = (name: string) => name.replace(/[013457@$!]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" })[c] ?? c);

/** a word with each run of one letter cut to one: "Jewwws", "Isssrael" */
const squeeze = (w: string) => w.replace(/([a-z])\1+/g, "$1");

/** a word and the forms it might be a plural or a "-man" of: "Russians", "Israel's", "Gypsies", "Frenchmen" */
function forms(w: string): string[] {
  const out = [w];
  if (w.length > 3 && w.endsWith("s")) out.push(w.slice(0, -1));
  // "-es" only where English or Spanish would add it, so "Spices" isn't read as anything
  if (w.length > 4 && w.endsWith("es") && /[sxzhnlriudjy]$/.test(w.slice(0, -2))) out.push(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("ies")) out.push(`${w.slice(0, -3)}y`);
  const man = /^(.{3,})(man|men|woman|women)$/.exec(w);
  if (man) out.push(man[1]);
  return out;
}

/** a word run together with "team", "go" or "fans" and the like, and what's left with them taken off: "teamisrael" is also israel */
function trimmed(w: string): string[] {
  const out = [w];
  for (let i = 0; i < out.length && out.length < 12; i++) {
    const x = out[i];
    for (const b of BEFORE) if (x.length > b.length + 1 && x.startsWith(b)) out.push(x.slice(b.length));
    for (const a of AFTER) if (x.length > a.length + 1 && x.endsWith(a)) out.push(x.slice(0, -a.length));
  }
  return out;
}

/** What a side's name says about people, as one way of reading it. */
type Reading = "people" | "context" | "maybe" | null;

/** The words to read a name against: whole, and with each run of one letter cut to one. */
type Words = { people: Set<string>; squashed: Set<string>; alone: Set<string>; context: Set<string>; maybe: Set<string>; everyday: string[] };

let built: { whole: Words; squeezed: Words } | null = null;

/** The word lists, built the first time a name is read. */
function lists(): { whole: Words; squeezed: Words } {
  if (built) return built;
  const set = (ls: string[]) => new Set(ls.flatMap((l) => l.split("|")).map((w) => words(w).join(" ")).filter((w) => w.length > 0));
  const maybe = set(MAYBE);
  const people = set([...COUNTRIES, ...HOME_NATIONS, ...PEOPLES, ...FAITHS, ...LOVE, ...HATE, ...SLURS.map(rot13), ...otherTongues()]);
  // other languages' names for countries, but where one's an everyday word here, only against another place
  for (const w of countriesAbroad()) if (!maybe.has(w)) people.add(w);
  for (const w of maybe) people.delete(w);
  const whole: Words = {
    people,
    // the same, written as one word: "USA", "U.S.A.", "LGBTQ+", "SaudiArabia"
    squashed: new Set([...people].map((w) => w.replace(/ /g, ""))),
    alone: set(ALONE),
    context: set(CONTEXT),
    maybe,
    everyday: EVERYDAY,
  };
  // squeezed, only the people words with no double letters, so "Isssrael" is Israel but "Collie" isn't anything
  const single = [...people].filter((w) => squeeze(w) === w);
  const squeezed: Words = { people: new Set(single), squashed: new Set(single.map((w) => w.replace(/ /g, ""))), alone: new Set(), context: new Set(), maybe: new Set(), everyday: EVERYDAY.map(squeeze) };
  built = { whole, squeezed };
  return built;
}

function read(name: string[], l: Words): Reading {
  let plain = ` ${name.join(" ")} `;
  for (const p of l.everyday) plain = plain.replaceAll(` ${p} `, " ").replaceAll(` ${p}s `, " ");
  const ws = plain.trim().split(" ").filter((w) => w.length > 0);
  if (ws.length === 0) return null;
  const is = (s: Set<string>) => (w: string) => forms(w).some((f) => s.has(f));
  // the whole name as one word, and any word run together with "team" or "fans"
  if ([ws.join(""), ...ws].some((w) => trimmed(w).some(is(l.squashed)))) return "people";
  // any run of up to four words that names people, its last word in any form
  for (let i = 0; i < ws.length; i++) {
    for (let n = 1; n <= 4 && i + n <= ws.length; n++) {
      const head = ws.slice(i, i + n - 1);
      for (const last of forms(ws[i + n - 1])) if (l.people.has([...head, last].join(" "))) return "people";
    }
  }
  const said = ws.filter((w) => !FILLER.has(w) && !PEOPLE.has(w));
  if (said.length === 0) return null;
  const people = ws.some((w) => PEOPLE.has(w));
  if (said.every((w) => is(l.alone)(w) || is(l.context)(w)) && (people || said.some(is(l.alone)))) return "people";
  if (said.every(is(l.context))) return "context";
  if (said.every(is(l.maybe))) return "maybe";
  return null;
}

/** what a side's name says about people, read as typed, with numbers read as letters, and with doubled letters cut down, whichever says most */
export function reading(name: string): Reading {
  const rank = (r: Reading) => (r === "people" ? 2 : r ? 1 : 0);
  const { whole, squeezed } = lists();
  let best: Reading = null;
  for (const typed of [name, unleet(name)]) {
    const ws = words(typed);
    for (const r of [read(ws, whole), read(ws.map(squeeze), squeezed)]) if (rank(r) > rank(best)) best = r;
  }
  return best;
}

/** Does this side's name, on its own, name people for who they are? */
export function namesPeople(name: string): boolean {
  return reading(name) === "people";
}

/** Do these two sides set people against each other: either names people, or both are words that do next to each other ("Black vs White", "Georgia vs Turkey")? */
export function pitsPeople(red: string, blue: string): boolean {
  const a = reading(red), b = reading(blue);
  return a === "people" || b === "people" || (a !== null && b !== null);
}
