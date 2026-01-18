/**
 * Resolves a potentially relative image URL against a base URL.
 *
 * @param imageBaseUrl - Base URL for images (should typically end with "/" but handles both cases)
 * @param imageUrl - The image URL to resolve (may be relative or absolute)
 * @returns The resolved URL, or undefined if imageUrl is falsy
 *
 * Rules:
 * - If imageUrl is falsy => return undefined
 * - If imageUrl starts with "http://" or "https://" => return imageUrl as-is
 * - If imageBaseUrl is falsy => return imageUrl as-is
 * - Otherwise join safely, avoiding double slashes
 */
export function resolveImageUrl(
  imageBaseUrl: string | undefined,
  imageUrl: string | undefined
): string | undefined {
  if (!imageUrl) {
    return undefined;
  }

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  if (!imageBaseUrl) {
    return imageUrl;
  }

  const baseEndsWithSlash = imageBaseUrl.endsWith('/');
  const urlStartsWithSlash = imageUrl.startsWith('/');

  if (baseEndsWithSlash && urlStartsWithSlash) {
    return imageBaseUrl + imageUrl.slice(1);
  }

  if (!baseEndsWithSlash && !urlStartsWithSlash) {
    return imageBaseUrl + '/' + imageUrl;
  }

  return imageBaseUrl + imageUrl;
}
