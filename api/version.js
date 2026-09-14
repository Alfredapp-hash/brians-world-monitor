import { fetchLatestRelease, fetchLatestTagName } from './_github-release.js';
import { jsonResponse } from './_json-response.js';

export const config = { runtime: 'edge' };

// Last-resort fallback when GitHub has no releases and no tags.
// Pinned to package.json by tests/netlify-api.test.mjs.
export const PACKAGE_VERSION = '1.0.0';
const REPO_URL = 'https://github.com/Alfredapp-hash/brians-world-monitor';
const VERSION_UA = 'WorldMonitor-Version-Check';
const VERSION_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600',
  'Access-Control-Allow-Origin': '*',
};

function versionResponse(version, tag, url, prerelease) {
  return jsonResponse({ version, tag, url, prerelease }, 200, VERSION_CACHE_HEADERS);
}

export default async function handler() {
  try {
    const release = await fetchLatestRelease(VERSION_UA);
    if (release) {
      const tag = release.tag_name ?? '';
      const version = tag.replace(/^v/, '') || PACKAGE_VERSION;
      return versionResponse(version, tag, release.html_url, release.prerelease ?? false);
    }

    const tagName = await fetchLatestTagName(VERSION_UA);
    if (tagName) {
      return versionResponse(
        tagName.replace(/^v/, '') || PACKAGE_VERSION,
        tagName,
        `${REPO_URL}/tree/${encodeURIComponent(tagName)}`,
        false,
      );
    }

    return versionResponse(PACKAGE_VERSION, `v${PACKAGE_VERSION}`, REPO_URL, false);
  } catch {
    return versionResponse(PACKAGE_VERSION, `v${PACKAGE_VERSION}`, REPO_URL, false);
  }
}
