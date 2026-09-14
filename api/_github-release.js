const REPO = 'Alfredapp-hash/brians-world-monitor';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAGS_URL = `https://api.github.com/repos/${REPO}/tags?per_page=1`;

function githubHeaders(userAgent) {
  return {
    'Accept': 'application/vnd.github+json',
    'User-Agent': userAgent,
  };
}

export async function fetchLatestRelease(userAgent) {
  const res = await fetch(RELEASES_URL, {
    headers: githubHeaders(userAgent),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Newest git tag name, or null when the tags API is empty / unavailable. */
export async function fetchLatestTagName(userAgent) {
  const res = await fetch(TAGS_URL, {
    headers: githubHeaders(userAgent),
  });
  if (!res.ok) return null;
  const tags = await res.json();
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const name = tags[0]?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}
