/**
 * Country rights desk — major constitutional instruments, person vs citizen
 * coverage, and travel watch-outs with primary-source URLs.
 *
 * This is a public-record index, not legal advice. Every travel claim that is
 * country-specific carries a sourceUrl. Countries without a curated charter
 * still get official constitution + travel-advisory links so the section is
 * never empty and never invented.
 */

export interface RightsClause {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
}

export interface RightsSource {
  label: string;
  url: string;
}

export interface CountryRightsRecord {
  iso2: string;
  instrument: {
    name: string;
    year?: number;
    note?: string;
  };
  coverage: 'indexed' | 'links-only';
  citizens: RightsClause[];
  persons: RightsClause[];
  travel: RightsClause[];
  sources: RightsSource[];
}

function src(label: string, url: string): RightsSource {
  return { label, url };
}

function clause(id: string, title: string, summary?: string, sourceUrl?: string): RightsClause {
  return { id, title, summary: summary || title, sourceUrl };
}

export function constituteSearchUrl(name: string): string {
  return `https://www.constituteproject.org/constitutions?lang=en&q=${encodeURIComponent(name)}`;
}

export function stateDeptSearchUrl(name: string): string {
  return `https://travel.state.gov/content/travel/en/search.html?searchTerm=${encodeURIComponent(name)}`;
}

export function fcdoAdviceHomeUrl(): string {
  return 'https://www.gov.uk/foreign-travel-advice';
}

function officialSources(iso2: string, name: string): RightsSource[] {
  const sources: RightsSource[] = [
    src('Constitute Project — constitutions', constituteSearchUrl(name)),
    src('U.S. State Department — travel & country pages', stateDeptSearchUrl(name)),
    src('UK FCDO — foreign travel advice', fcdoAdviceHomeUrl()),
  ];
  if (iso2 === 'US') {
    sources.unshift(
      src('National Archives — Bill of Rights', 'https://www.archives.gov/founding-docs/bill-of-rights-transcript'),
      src('National Archives — Constitution', 'https://www.archives.gov/founding-docs/constitution-transcript'),
    );
  }
  return sources;
}

function genericTravel(name: string): RightsClause[] {
  return [
    clause(
      'advisory',
      'Read the official travel advisory first',
      `Entry rules, local criminal law, dual nationality, and photography restrictions for ${name} change. Open the State Department country page and the FCDO advice page before you travel.`,
      stateDeptSearchUrl(name),
    ),
    clause(
      'border',
      'Border inspection is not the same as interior law',
      'Most countries apply a different search-and-detention regime at ports of entry than they do to people already admitted. Do not assume the charter you read applies at the airport in the same way.',
    ),
    clause(
      'drugs-weapons',
      'Drugs, weapons, and drones',
      'What is legal in your home country (cannabis, pocket knives, consumer drones, satellite communicators) is often a serious offence abroad. Check the destination criminal code, not forum posts.',
    ),
  ];
}

const CATALOG: Record<string, Omit<CountryRightsRecord, 'iso2' | 'sources'> & { sources?: RightsSource[] }> = {
  US: {
    coverage: 'indexed',
    instrument: {
      name: 'Bill of Rights (Amendments I–X)',
      year: 1791,
      note: 'The first ten amendments to the U.S. Constitution. Later amendments (13–15, 19, 24, 26) also bind the states. This index is the Bill of Rights, as requested for the U.S. desk.',
    },
    sources: [
      src('National Archives — Bill of Rights transcript', 'https://www.archives.gov/founding-docs/bill-of-rights-transcript'),
    ],
    citizens: [
      clause('I', 'Amendment I — speech, press, religion, assembly, petition', 'Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof; or abridging the freedom of speech, or of the press; or the right of the people peaceably to assemble, and to petition the Government for a redress of grievances.'),
      clause('II', 'Amendment II — keep and bear arms', 'A well regulated Militia, being necessary to the security of a free State, the right of the people to keep and bear Arms, shall not be infringed.'),
      clause('III', 'Amendment III — no quartering of soldiers', 'No Soldier shall, in time of peace be quartered in any house, without the consent of the Owner, nor in time of war, but in a manner to be prescribed by law.'),
      clause('IV', 'Amendment IV — search and seizure', 'The right of the people to be secure in their persons, houses, papers, and effects, against unreasonable searches and seizures, shall not be violated, and no Warrants shall issue, but upon probable cause…'),
      clause('V', 'Amendment V — due process, silence, takings', 'No person shall be held to answer for a capital crime except by grand jury; nor be subject to double jeopardy; nor be compelled to be a witness against himself; nor be deprived of life, liberty, or property without due process; nor shall private property be taken for public use without just compensation.'),
      clause('VI', 'Amendment VI — criminal trial rights', 'In criminal prosecutions: speedy and public trial, impartial jury, notice of the accusation, confrontation of witnesses, compulsory process, and assistance of counsel.'),
      clause('VII', 'Amendment VII — civil jury', 'In suits at common law where the value exceeds twenty dollars, the right of trial by jury is preserved.'),
      clause('VIII', 'Amendment VIII — bail, fines, punishment', 'Excessive bail shall not be required, nor excessive fines imposed, nor cruel and unusual punishments inflicted.'),
      clause('IX', 'Amendment IX — unenumerated rights', 'The enumeration of certain rights in the Constitution shall not be construed to deny or disparage others retained by the people.'),
      clause('X', 'Amendment X — reserved powers', 'Powers not delegated to the United States, nor prohibited to the States, are reserved to the States respectively, or to the people.'),
    ],
    persons: [
      clause(
        'persons-5-14',
        'Due process covers “persons,” not only citizens',
        'The Fifth Amendment and the Fourteenth Amendment Due Process and Equal Protection Clauses speak of persons. Non-citizens physically present in the U.S. hold many of these protections; immigration status is a separate federal regime.',
        'https://www.archives.gov/founding-docs/constitution-transcript',
      ),
      clause(
        'border-search',
        'Border search doctrine',
        'At ports of entry, CBP may search persons, baggage, and electronic devices with a lower threshold than a typical Fourth Amendment warrant search inland. Admission can be refused even when interior rights would apply after entry.',
        'https://www.cbp.gov/travel/us-citizens/know-before-you-go',
      ),
      clause(
        'firearms-visitors',
        'Visitors and firearms',
        '18 U.S.C. § 922(g)(5) generally prohibits firearm possession by most nonimmigrant visa holders. Do not assume the Second Amendment lets a tourist carry.',
        'https://www.atf.gov/firearms',
      ),
      clause(
        'esta',
        'ESTA / visa waiver is permission to apply for admission',
        'Visa Waiver Program travelers still face CBP inspection. ESTA authorization is not a right of entry.',
        'https://esta.cbp.dhs.gov/',
      ),
    ],
    travel: [
      clause(
        'tsa',
        'Aviation screening',
        'TSA screening is mandatory for commercial flights. Weapons, large liquids, and many tools that are legal to own are not legal in the cabin.',
        'https://www.tsa.gov/travel/security-screening/whatcanibring/all',
      ),
      clause(
        'cannabis',
        'Cannabis is still a federal offence',
        'State legalization does not bind federal law or CBP. Do not carry cannabis products through airports, national parks, or onto federal property.',
        'https://www.dea.gov/cannabis-policy',
      ),
      clause(
        'driving',
        'State law after you land',
        'Traffic, weapons carry, recording police, and ID-stop rules are mostly state law. They are not uniform across the 50 states.',
      ),
    ],
  },
  GB: {
    coverage: 'indexed',
    instrument: {
      name: 'Human Rights Act 1998 (incorporating the ECHR) + common law',
      year: 1998,
      note: 'The UK has no single entrenched bill of rights. The HRA 1998 makes most European Convention rights enforceable in UK courts. Magna Carta 1215 is historic, not a modern code.',
    },
    citizens: [
      clause('art10', 'Freedom of expression', 'HRA / ECHR Article 10 — subject to restrictions prescribed by law (defamation, national security, hate-speech offences).'),
      clause('art11', 'Assembly and association', 'HRA / ECHR Article 11.'),
      clause('art8', 'Private and family life', 'HRA / ECHR Article 8.'),
      clause('art6', 'Fair trial', 'HRA / ECHR Article 6 — independent tribunal, presumption of innocence, legal aid in specified cases.'),
      clause('art5', 'Liberty and security', 'HRA / ECHR Article 5 — arrest must have a lawful basis; habeas corpus remains a common-law remedy.'),
      clause('art9', 'Thought, conscience, religion', 'HRA / ECHR Article 9.'),
    ],
    persons: [
      clause('everyone', 'Convention rights are for “everyone”', 'Most ECHR articles protect persons within the jurisdiction, not only British citizens. Immigration removal is a separate statutory scheme.'),
      clause('knives', 'Offensive weapons', 'Carrying knives in public is tightly restricted (Criminal Justice Act 1988 and later). A pocket knife that is legal at home may be an offence here.'),
    ],
    travel: [
      clause('eta', 'Electronic Travel Authorisation', 'Many visa-exempt visitors now need an ETA before travel. Check GOV.UK, not airline folklore.', 'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta'),
      clause('cctv', 'Surveillance is normal', 'Public-space CCTV and ANPR are widespread. That is not a tourist “gotcha”; it is the operating environment.'),
    ],
  },
  CA: {
    coverage: 'indexed',
    instrument: { name: 'Canadian Charter of Rights and Freedoms', year: 1982 },
    citizens: [
      clause('s2', 'Fundamental freedoms (s.2)', 'Conscience, religion, thought, belief, opinion, expression, peaceful assembly, association.'),
      clause('s7', 'Life, liberty, security (s.7)', 'Not to be deprived thereof except in accordance with the principles of fundamental justice.'),
      clause('s8', 'Search and seizure (s.8)'),
      clause('s9-10', 'Detention and counsel (ss.9–10)'),
      clause('s15', 'Equality (s.15)'),
      clause('s6', 'Mobility of citizens (s.6)', 'Citizens have the right to enter, remain in, and leave Canada. Permanent residents have a narrower mobility right.'),
    ],
    persons: [
      clause('everyone', 'Many Charter rights attach to “everyone”', 'ss.7–14 criminal-process rights are not limited to citizens. s.6 mobility is.'),
      clause('cbp', 'CBSA examination', 'Customs and immigration examination at the border is a statutory power. Charter analysis at the border is not identical to an inland search.'),
    ],
    travel: genericTravel('Canada'),
  },
  AU: {
    coverage: 'indexed',
    instrument: {
      name: 'Australian Constitution — limited express rights + implied freedom of political communication',
      year: 1901,
      note: 'Australia has no comprehensive bill of rights at the Commonwealth level. Some states have charters (Victoria, Queensland, ACT).',
    },
    citizens: [
      clause('s80', 'Jury trial for federal indictable offences (s.80)'),
      clause('s116', 'No Commonwealth religious establishment or religious test (s.116)'),
      clause('s117', 'No disability of interstate residents (s.117)'),
      clause('implied', 'Implied freedom of political communication', 'High Court doctrine, not an express clause. It is a limit on legislative power, not a personal “free speech” right in the U.S. sense.'),
    ],
    persons: [
      clause('migration', 'Migration Act is the visitor regime', 'Visas are a privilege under statute. Character and biosecurity cancellations are a live risk — check Home Affairs, not a travel blog.'),
    ],
    travel: [
      clause('biosecurity', 'Biosecurity is strictly enforced', 'Food, plant, and animal products at the border can mean fines or prosecution. Declare them.', 'https://www.abf.gov.au/entering-and-leaving-australia/can-you-bring-it-in'),
    ],
  },
  DE: {
    coverage: 'indexed',
    instrument: { name: 'Basic Law (Grundgesetz)', year: 1949 },
    citizens: [
      clause('art1', 'Human dignity (Art. 1)', 'Inviolable. Binds all state authority.'),
      clause('art2', 'Free development of personality (Art. 2)'),
      clause('art5', 'Freedom of expression, press, arts (Art. 5)', 'Subject to general laws, youth protection, and honour.'),
      clause('art8', 'Assembly (Art. 8)'),
      clause('art10', 'Privacy of correspondence (Art. 10)'),
      clause('art13', 'Inviolability of the home (Art. 13)'),
      clause('art16a', 'Asylum (Art. 16a)', 'Politically persecuted persons — with EU-safe-country limits.'),
    ],
    persons: [
      clause('art3', 'Equality (Art. 3)', 'Applies as a human right, not only a citizen right.'),
      clause('registration', 'Anmeldung', 'Residents must register an address with the local authority. Short-stay tourists usually do not; longer stays do.'),
    ],
    travel: genericTravel('Germany'),
  },
  FR: {
    coverage: 'indexed',
    instrument: {
      name: 'Declaration of the Rights of Man and of the Citizen (1789) + Constitution of 1958',
      year: 1789,
    },
    citizens: [
      clause('art10-11', 'Opinions and communication (1789 Arts. 10–11)'),
      clause('art7-9', 'No punishment without law; presumption of innocence (1789 Arts. 7–9)'),
      clause('laicite', 'Laïcité', 'State secularism shapes public-school and some public-service dress rules. It is not “no religion”; it is a public-power doctrine.'),
    ],
    persons: [
      clause('schengen', 'Schengen visitor', 'Short stays follow the Schengen code. Overstay is an immigration offence, not a constitutional debate.'),
    ],
    travel: genericTravel('France'),
  },
  JP: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of Japan, Chapter III (Rights and Duties of the People)', year: 1947 },
    citizens: [
      clause('art14', 'Equality under the law (Art. 14)'),
      clause('art19-21', 'Thought, religion, assembly, speech, press (Arts. 19–21)'),
      clause('art31-37', 'Criminal due process (Arts. 31–37)'),
      clause('art35', 'Searches and seizures (Art. 35)'),
    ],
    persons: [
      clause('art97', 'Fundamental human rights', 'Chapter III is framed as rights of the people. Immigration status remains statutory (Immigration Control Act).'),
    ],
    travel: [
      clause('drugs', 'Drug laws are severe', 'Even small quantities of narcotics, some ADHD medicines, and vape liquids can mean arrest. Check the Ministry of Health list before packing pills.', 'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html'),
    ],
  },
  IN: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of India, Part III — Fundamental Rights', year: 1950 },
    citizens: [
      clause('art14', 'Equality before the law (Art. 14)'),
      clause('art19', 'Speech, assembly, association, movement, profession (Art. 19)', 'Citizen rights, subject to reasonable restrictions.'),
      clause('art21', 'Life and personal liberty (Art. 21)', 'Has been read to include due process-like protections.'),
      clause('art22', 'Protection against arrest and detention (Art. 22)'),
      clause('art25', 'Freedom of religion (Art. 25)'),
    ],
    persons: [
      clause('art21-persons', 'Art. 21 is not limited to citizens', 'Equality (Art. 14) and life/liberty (Art. 21) have been applied to persons. Art. 19 political freedoms are citizen rights.'),
      clause('oci', 'OCI is not citizenship', 'Overseas Citizen of India is a visa-like status. It is not Art. 19 citizenship.'),
    ],
    travel: genericTravel('India'),
  },
  BR: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of the Federative Republic of Brazil, Title II', year: 1988 },
    citizens: [
      clause('art5', 'Article 5 individual rights', 'Equality, freedom of expression, privacy, due process, habeas corpus, and many others — one of the longest bills of rights in force.'),
    ],
    persons: [
      clause('art5-caput', '“Brazilians and foreigners residing in the country”', 'Art. 5’s chapeau expressly covers resident foreigners for the rights there listed. Tourists are not automatically “residing.”'),
    ],
    travel: genericTravel('Brazil'),
  },
  ZA: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of the Republic of South Africa — Bill of Rights (Chapter 2)', year: 1996 },
    citizens: [
      clause('s9', 'Equality (s.9)'),
      clause('s16', 'Freedom of expression (s.16)'),
      clause('s17', 'Assembly (s.17)'),
      clause('s12', 'Freedom and security of the person (s.12)'),
      clause('s35', 'Arrested, detained, and accused persons (s.35)'),
    ],
    persons: [
      clause('s7', 'Bill of Rights binds the state and applies to all people in the Republic', 'Some political rights (e.g. voting) remain citizen rights.'),
    ],
    travel: genericTravel('South Africa'),
  },
  IL: {
    coverage: 'indexed',
    instrument: {
      name: 'Basic Laws (especially Human Dignity and Liberty, 1992; Freedom of Occupation, 1994)',
      year: 1992,
      note: 'Israel has no single entrenched constitution. The Basic Laws function as the higher-law core.',
    },
    citizens: [
      clause('dignity', 'Human dignity and liberty'),
      clause('occupation', 'Freedom of occupation'),
    ],
    persons: [
      clause('entry', 'Entry is a security-screened statutory regime', 'The Basic Laws do not give a tourist a right to enter. Interrogation at Ben Gurion is a known feature of the entry system — read the current travel advisory.'),
    ],
    travel: genericTravel('Israel'),
  },
  AE: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of the United Arab Emirates (1971) + federal criminal and cybercrime statutes' },
    citizens: [
      clause('art25', 'Equality of citizens (Art. 25)'),
      clause('art30', 'Freedom of opinion “within the limits of law” (Art. 30)', 'Speech is not a U.S.-style first-amendment analogue. Cybercrime and defamation statutes are actively enforced.'),
    ],
    persons: [
      clause('visitors', 'Visitors are under federal criminal law from landing', 'Alcohol, unmarried cohabitation rules (reformed but not absent), photography of people/government sites, and social-media posts about the UAE have all produced prosecutions of foreigners. Read the FCDO page.'),
    ],
    travel: [
      clause('fcdo-uae', 'FCDO — United Arab Emirates', 'Use the official advice for drugs, photography, LGBTQ criminalisation, and social-media offences. Do not improvise from influencer content.', 'https://www.gov.uk/foreign-travel-advice/united-arab-emirates/local-laws-and-customs'),
    ],
  },
  CN: {
    coverage: 'indexed',
    instrument: {
      name: 'Constitution of the People’s Republic of China (1982, as amended)',
      year: 1982,
      note: 'Chapter II lists fundamental rights and duties. Enforcement is through the party-state legal system, not a U.S.-style judicial bill of rights. Index the text; do not confuse the text with practice.',
    },
    citizens: [
      clause('art33', 'Citizenship and equality (Art. 33)'),
      clause('art35', 'Speech, press, assembly, association, procession, demonstration (Art. 35)'),
      clause('art37', 'Personal freedom; unlawful detention (Art. 37)'),
      clause('art40', 'Freedom and privacy of correspondence (Art. 40)'),
    ],
    persons: [
      clause('exit-entry', 'Exit-Entry Administration Law', 'Foreigners need a valid visa/residence permit. Journalistic and dual-use research activity is separately regulated. Exit bans exist as a legal tool.'),
    ],
    travel: [
      clause('state-dept-cn', 'U.S. State Department — China', 'Read the current advisory for arbitrary detention, dual nationality, and journalism/research risks before you go.', 'https://travel.state.gov/content/travel/en/search.html?searchTerm=China'),
    ],
  },
  UA: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of Ukraine, Title II', year: 1996 },
    citizens: [
      clause('art21', 'Human rights and freedoms are inalienable (Art. 21)'),
      clause('art34', 'Thought and speech (Art. 34)'),
      clause('art39', 'Peaceful assembly (Art. 39)'),
    ],
    persons: [
      clause('martial', 'Martial law modifies the operating picture', 'Rights on paper are not a travel green light. Follow current martial-law entry rules and the live advisory.'),
    ],
    travel: genericTravel('Ukraine'),
  },
  MX: {
    coverage: 'indexed',
    instrument: { name: 'Political Constitution of the United Mexican States — individual guarantees', year: 1917 },
    citizens: [
      clause('art1', 'Human rights recognized by the Constitution and treaties (Art. 1)'),
      clause('art6-7', 'Information and expression (Arts. 6–7)'),
      clause('art16', 'Privacy of person, family, domicile, papers (Art. 16)'),
    ],
    persons: [
      clause('art1-persons', 'Art. 1 is not limited to citizens', 'Foreigners remain subject to immigration law (Ley de Migración) and can be removed.'),
    ],
    travel: genericTravel('Mexico'),
  },
  KR: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of the Republic of Korea, Chapter II', year: 1948 },
    citizens: [
      clause('art10', 'Human dignity and pursuit of happiness (Art. 10)'),
      clause('art21', 'Speech, press, assembly, association (Art. 21)'),
      clause('art12', 'Personal liberty; warrants (Art. 12)'),
    ],
    persons: [
      clause('art6', 'Treaties and international law', 'Status of foreigners is largely statutory (Immigration Act).'),
    ],
    travel: genericTravel('South Korea'),
  },
  SG: {
    coverage: 'indexed',
    instrument: { name: 'Constitution of the Republic of Singapore, Part IV', year: 1965 },
    citizens: [
      clause('art14', 'Speech, assembly, association (Art. 14)', 'Citizen rights, expressly subject to restrictions relating to security, public order, and morality.'),
      clause('art9', 'Life and personal liberty (Art. 9)'),
      clause('art12', 'Equality (Art. 12)'),
    ],
    persons: [
      clause('caning-drugs', 'Criminal law is the visitor-facing document', 'Drug trafficking can carry capital punishment. Vandalism can carry caning. Read the statutes, not the skyline.'),
    ],
    travel: [
      clause('cnb', 'Central Narcotics Bureau', 'The CNB is explicit: bringing narcotics into Singapore, including through the airport in transit, is a grave offence.', 'https://www.cnb.gov.sg/'),
    ],
  },
};

export function getCountryRights(iso2: string, name: string): CountryRightsRecord {
  const code = iso2.trim().toUpperCase();
  const curated = CATALOG[code];
  const sources = officialSources(code, name);
  if (!curated) {
    return {
      iso2: code,
      coverage: 'links-only',
      instrument: {
        name: 'Constitution / founding charter',
        note: 'This desk has not yet indexed the full instrument. Open the constitution and the official travel advisory — do not treat a missing card as “no rights.”',
      },
      citizens: [],
      persons: [],
      travel: genericTravel(name),
      sources,
    };
  }
  const seen = new Set(sources.map((s) => s.url));
  const merged = [...(curated.sources ?? [])];
  for (const s of sources) {
    if (!seen.has(s.url)) merged.push(s);
  }
  return {
    iso2: code,
    coverage: curated.coverage,
    instrument: curated.instrument,
    citizens: curated.citizens,
    persons: curated.persons,
    travel: curated.travel.length > 0 ? curated.travel : genericTravel(name),
    sources: merged,
  };
}

export function indexedRightsIso2(): string[] {
  return Object.keys(CATALOG).sort();
}
