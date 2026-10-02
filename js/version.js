// Single source of truth for the asset cache-busting version.
//
// Bump this whenever you ship a change to any file under js/. It is appended
// as a query string to every module import (see main.js) and to the entry
// script in index.html, so browsers re-fetch the whole module graph instead of
// serving stale copies.
//
// Keep the value in index.html's <script src="js/main.js?v=..."> in sync.
export const ASSET_VERSION = '20261002d';
