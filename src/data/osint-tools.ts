/**
 * OSINT4ALL directory — public tools a civilian can actually use.
 * Editorial order. No paid ranking. Official URLs only.
 */

export type OsintPricing = 'Free' | 'Freemium' | 'Paid';

export type OsintCategory =
  | 'Archives'
  | 'Domain & DNS'
  | 'Maps & imagery'
  | 'Aviation & maritime'
  | 'Public records'
  | 'Company research'
  | 'Threat intel'
  | 'People & social'
  | 'Image & video'
  | 'Constitutions & law'
  | 'Travel & entry'
  | 'Conflict & events'
  | 'Spending & contracts';

export interface OsintTool {
  id: string;
  name: string;
  domain: string;
  url: string;
  category: OsintCategory;
  pricing: OsintPricing;
  summary: string;
  bestFor: string;
  usedByDispatch?: boolean;
}

export const OSINT_CATEGORIES: OsintCategory[] = [
  'Archives',
  'Domain & DNS',
  'Maps & imagery',
  'Aviation & maritime',
  'Public records',
  'Company research',
  'Threat intel',
  'People & social',
  'Image & video',
  'Constitutions & law',
  'Travel & entry',
  'Conflict & events',
  'Spending & contracts',
];

export const OSINT_TOOLS: OsintTool[] = [
  {
    id: 'wayback',
    name: 'Internet Archive Wayback Machine',
    domain: 'web.archive.org',
    url: 'https://web.archive.org/',
    category: 'Archives',
    pricing: 'Free',
    summary: 'Historical snapshots of public web pages.',
    bestFor: 'Recovering deleted pages, dating a claim, documenting a source as it appeared.',
  },
  {
    id: 'archive-today',
    name: 'archive.today',
    domain: 'archive.today',
    url: 'https://archive.today/',
    category: 'Archives',
    pricing: 'Free',
    summary: 'On-demand snapshot of a live URL.',
    bestFor: 'Preserving a page that may change or disappear during an investigation.',
  },
  {
    id: 'crtsh',
    name: 'crt.sh',
    domain: 'crt.sh',
    url: 'https://crt.sh/',
    category: 'Domain & DNS',
    pricing: 'Free',
    summary: 'Certificate Transparency search.',
    bestFor: 'Finding hostnames a domain has requested certificates for.',
  },
  {
    id: 'securitytrails',
    name: 'SecurityTrails',
    domain: 'securitytrails.com',
    url: 'https://securitytrails.com/',
    category: 'Domain & DNS',
    pricing: 'Freemium',
    summary: 'Historical DNS, WHOIS, and associated infrastructure.',
    bestFor: 'Pivoting from a domain to related hosts and registrants.',
  },
  {
    id: 'urlscan',
    name: 'urlscan.io',
    domain: 'urlscan.io',
    url: 'https://urlscan.io/',
    category: 'Domain & DNS',
    pricing: 'Freemium',
    summary: 'Live scan of a URL: DOM, requests, screenshots, indicators.',
    bestFor: 'Looking at a suspicious page without opening it in your own browser.',
  },
  {
    id: 'opensky',
    name: 'OpenSky Network',
    domain: 'opensky-network.org',
    url: 'https://opensky-network.org/',
    category: 'Aviation & maritime',
    pricing: 'Free',
    summary: 'Open ADS-B flight tracking.',
    bestFor: 'Public-interest aircraft movement and historical tracks.',
    usedByDispatch: true,
  },
  {
    id: 'adsbexchange',
    name: 'ADS-B Exchange',
    domain: 'adsbexchange.com',
    url: 'https://globe.adsbexchange.com/',
    category: 'Aviation & maritime',
    pricing: 'Freemium',
    summary: 'Unfiltered ADS-B globe.',
    bestFor: 'Aircraft that other networks may filter.',
    usedByDispatch: true,
  },
  {
    id: 'marinetraffic',
    name: 'MarineTraffic',
    domain: 'marinetraffic.com',
    url: 'https://www.marinetraffic.com/',
    category: 'Aviation & maritime',
    pricing: 'Freemium',
    summary: 'AIS vessel positions and port calls.',
    bestFor: 'Ship movement, port activity, route history.',
    usedByDispatch: true,
  },
  {
    id: 'acled',
    name: 'ACLED',
    domain: 'acleddata.com',
    url: 'https://acleddata.com/',
    category: 'Conflict & events',
    pricing: 'Free',
    summary: 'Political violence and protest event data.',
    bestFor: 'Structured conflict, protest, and actor research.',
    usedByDispatch: true,
  },
  {
    id: 'ucdp',
    name: 'UCDP',
    domain: 'ucdp.uu.se',
    url: 'https://ucdp.uu.se/',
    category: 'Conflict & events',
    pricing: 'Free',
    summary: 'Uppsala Conflict Data Program.',
    bestFor: 'Academic-grade armed-conflict statistics.',
    usedByDispatch: true,
  },
  {
    id: 'firms',
    name: 'NASA FIRMS',
    domain: 'firms.modaps.eosdis.nasa.gov',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    category: 'Maps & imagery',
    pricing: 'Free',
    summary: 'Satellite fire detections.',
    bestFor: 'Near-real-time thermal anomalies.',
    usedByDispatch: true,
  },
  {
    id: 'usgs',
    name: 'USGS Earthquake Hazards',
    domain: 'earthquake.usgs.gov',
    url: 'https://earthquake.usgs.gov/earthquakes/map/',
    category: 'Maps & imagery',
    pricing: 'Free',
    summary: 'Global earthquake feed and maps.',
    bestFor: 'Confirming a seismic event against rumor.',
    usedByDispatch: true,
  },
  {
    id: 'gfw',
    name: 'Global Forest Watch',
    domain: 'globalforestwatch.org',
    url: 'https://www.globalforestwatch.org/',
    category: 'Maps & imagery',
    pricing: 'Free',
    summary: 'Forest-change alerts and geospatial layers.',
    bestFor: 'Land-use and deforestation context.',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    domain: 'openstreetmap.org',
    url: 'https://www.openstreetmap.org/',
    category: 'Maps & imagery',
    pricing: 'Free',
    summary: 'Collaborative world map.',
    bestFor: 'Place names, roads, and facilities that commercial maps omit.',
    usedByDispatch: true,
  },
  {
    id: 'sam',
    name: 'SAM.gov',
    domain: 'sam.gov',
    url: 'https://sam.gov/',
    category: 'Spending & contracts',
    pricing: 'Free',
    summary: 'U.S. federal entity registration and opportunities.',
    bestFor: 'Contractor / grantee identity and Unique Entity ID checks.',
  },
  {
    id: 'usaspending',
    name: 'USAspending.gov',
    domain: 'usaspending.gov',
    url: 'https://www.usaspending.gov/',
    category: 'Spending & contracts',
    pricing: 'Free',
    summary: 'Official U.S. federal award spending.',
    bestFor: 'Contracts, grants, loans, recipients, agencies.',
  },
  {
    id: 'ted',
    name: 'TED — Tenders Electronic Daily',
    domain: 'ted.europa.eu',
    url: 'https://ted.europa.eu/',
    category: 'Spending & contracts',
    pricing: 'Free',
    summary: 'EU public procurement notices.',
    bestFor: 'European contract awards and buyer/supplier leads.',
  },
  {
    id: 'gleif',
    name: 'GLEIF LEI Search',
    domain: 'search.gleif.org',
    url: 'https://search.gleif.org/',
    category: 'Company research',
    pricing: 'Free',
    summary: 'Legal Entity Identifier records.',
    bestFor: 'Confirming a company’s legal name and LEI status.',
  },
  {
    id: 'opencorporates',
    name: 'OpenCorporates',
    domain: 'opencorporates.com',
    url: 'https://opencorporates.com/',
    category: 'Company research',
    pricing: 'Freemium',
    summary: 'Company registry search across jurisdictions.',
    bestFor: 'Officers, filings, and corporate trees from public registers.',
  },
  {
    id: 'icij',
    name: 'ICIJ Offshore Leaks Database',
    domain: 'offshoreleaks.icij.org',
    url: 'https://offshoreleaks.icij.org/',
    category: 'Company research',
    pricing: 'Free',
    summary: 'Offshore entities and intermediaries from ICIJ investigations.',
    bestFor: 'Checking whether a name appears in leak datasets.',
  },
  {
    id: 'pacer',
    name: 'PACER / RECAP',
    domain: 'pacer.uscourts.gov',
    url: 'https://pacer.uscourts.gov/',
    category: 'Public records',
    pricing: 'Paid',
    summary: 'U.S. federal court records. RECAP (CourtListener) republishes many for free.',
    bestFor: 'Dockets, complaints, and judgments.',
  },
  {
    id: 'courtlistener',
    name: 'CourtListener',
    domain: 'courtlistener.com',
    url: 'https://www.courtlistener.com/',
    category: 'Public records',
    pricing: 'Free',
    summary: 'Free U.S. court opinions and RECAP dockets.',
    bestFor: 'Case law and federal filings without a PACER bill.',
  },
  {
    id: 'opencorporates-uk',
    name: 'Companies House',
    domain: 'companieshouse.gov.uk',
    url: 'https://find-and-update.company-information.service.gov.uk/',
    category: 'Public records',
    pricing: 'Free',
    summary: 'UK company filings.',
    bestFor: 'Officers, PSCs, and accounts for UK entities.',
  },
  {
    id: 'constitute',
    name: 'Constitute Project',
    domain: 'constituteproject.org',
    url: 'https://www.constituteproject.org/',
    category: 'Constitutions & law',
    pricing: 'Free',
    summary: 'Searchable constitutions of the world.',
    bestFor: 'The actual charter behind a country’s “rights” claims.',
    usedByDispatch: true,
  },
  {
    id: 'congress-gov',
    name: 'Congress.gov',
    domain: 'congress.gov',
    url: 'https://www.congress.gov/',
    category: 'Constitutions & law',
    pricing: 'Free',
    summary: 'U.S. legislation, the Constitution, and the Congressional Record.',
    bestFor: 'Bills, statutes at large, and the Bill of Rights in context.',
  },
  {
    id: 'state-dept',
    name: 'U.S. State Department Travel',
    domain: 'travel.state.gov',
    url: 'https://travel.state.gov/',
    category: 'Travel & entry',
    pricing: 'Free',
    summary: 'Official U.S. travel advisories and country information.',
    bestFor: 'What to watch before you go — from the government, not a forum.',
    usedByDispatch: true,
  },
  {
    id: 'fcdo',
    name: 'UK FCDO Foreign Travel Advice',
    domain: 'gov.uk',
    url: 'https://www.gov.uk/foreign-travel-advice',
    category: 'Travel & entry',
    pricing: 'Free',
    summary: 'UK government country travel advice, including local laws.',
    bestFor: 'Entry rules, criminal law, and LGBT / dual-nationality warnings.',
    usedByDispatch: true,
  },
  {
    id: 'invid',
    name: 'InVID / WeVerify',
    domain: 'www.invid-project.eu',
    url: 'https://www.invid-project.eu/tools-and-services/invid-verification-plugin/',
    category: 'Image & video',
    pricing: 'Free',
    summary: 'Video keyframes, reverse image, and metadata helpers.',
    bestFor: 'Checking whether a clip is old, cropped, or from somewhere else.',
  },
  {
    id: 'tineye',
    name: 'TinEye',
    domain: 'tineye.com',
    url: 'https://tineye.com/',
    category: 'Image & video',
    pricing: 'Freemium',
    summary: 'Reverse image search.',
    bestFor: 'Finding earlier uses of a photo.',
  },
  {
    id: 'bellingcat-toolkit',
    name: 'Bellingcat Online Investigation Toolkit',
    domain: 'bellingcat.gitbook.io',
    url: 'https://bellingcat.gitbook.io/toolkit',
    category: 'Image & video',
    pricing: 'Free',
    summary: 'Curated methods, not a single product.',
    bestFor: 'Learning how to verify a geolocation instead of guessing.',
  },
  {
    id: 'sherlock',
    name: 'Sherlock',
    domain: 'github.com',
    url: 'https://github.com/sherlock-project/sherlock',
    category: 'People & social',
    pricing: 'Free',
    summary: 'Username search across public sites. Self-hosted.',
    bestFor: 'Seeing where a handle exists — then verifying each hit.',
  },
  {
    id: 'whatsmyname',
    name: 'WhatsMyName',
    domain: 'whatsmyname.app',
    url: 'https://whatsmyname.app/',
    category: 'People & social',
    pricing: 'Free',
    summary: 'Browser username check across platforms.',
    bestFor: 'A first-pass handle pivot without installing anything.',
  },
  {
    id: 'intelx',
    name: 'Intelligence X',
    domain: 'intelx.io',
    url: 'https://intelx.io/',
    category: 'Threat intel',
    pricing: 'Freemium',
    summary: 'Selectors across leaks, darknet, and historical data.',
    bestFor: 'Checking whether an email, domain, or bitcoin address already leaked.',
  },
  {
    id: 'urlhaus',
    name: 'URLhaus',
    domain: 'urlhaus.abuse.ch',
    url: 'https://urlhaus.abuse.ch/',
    category: 'Threat intel',
    pricing: 'Free',
    summary: 'Malware URL exchange.',
    bestFor: 'Checking a link before you click it.',
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    domain: 'openalex.org',
    url: 'https://openalex.org/',
    category: 'Public records',
    pricing: 'Free',
    summary: 'Scholarly works, authors, institutions, funders.',
    bestFor: 'Citation trails and who funded a paper.',
  },
  {
    id: 'haveibeenpwned',
    name: 'Have I Been Pwned',
    domain: 'haveibeenpwned.com',
    url: 'https://haveibeenpwned.com/',
    category: 'Threat intel',
    pricing: 'Free',
    summary: 'Breach notification for email addresses.',
    bestFor: 'Checking whether an identity already spilled — with the owner’s consent.',
  },
];

export function filterOsintTools(opts: {
  query?: string;
  category?: OsintCategory | 'Any';
  pricing?: OsintPricing | 'Any';
}): OsintTool[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return OSINT_TOOLS.filter((tool) => {
    if (opts.category && opts.category !== 'Any' && tool.category !== opts.category) return false;
    if (opts.pricing && opts.pricing !== 'Any' && tool.pricing !== opts.pricing) return false;
    if (!q) return true;
    const hay = `${tool.name} ${tool.domain} ${tool.summary} ${tool.bestFor} ${tool.category}`.toLowerCase();
    return hay.includes(q);
  });
}
