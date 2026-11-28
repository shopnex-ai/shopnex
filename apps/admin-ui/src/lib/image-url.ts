// What a theme setting stores for an uploaded image. A file on this app's own disk comes back as `${APP_URL}/api/files/{key}`;
// saved like that, every theme would keep pointing at the old host after the domain changes. The API answers on every host
// (the storefront and the shops' own domains reach it too), so the path alone is enough. Anything else (a bucket's public URL,
// an image pasted from another site) is stored as it is.
const OWN_FILES = '/api/files/'

export function storedImageUrl(url: string, origin: string): string {
  try {
    const parsed = new URL(url)
    return parsed.origin === origin && parsed.pathname.startsWith(OWN_FILES) && !parsed.search && !parsed.hash
      ? parsed.pathname
      : url
  } catch {
    return url
  }
}

/** Whether the editor can show the value as a picture: an absolute URL, or a path on this host */
export const isShowableImage = (value: string) => /^https?:\/\//.test(value) || /^\/(?!\/)/.test(value)
