/**
 * Bump when the icons in public/icons change: browsers and the installed app cache icons
 * by URL, so a new version in the URL makes them fetch the new files.
 * Also bump VERSION in public/sw.js.
 */
export const ICON_VERSION = "2";

export const iconUrl = (file: string) => `/icons/${file}?v=${ICON_VERSION}`;
