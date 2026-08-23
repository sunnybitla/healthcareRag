/**
 * Centralized API URL resolver and normalizer.
 * Handles trailing slashes, accidental '/api' suffixes, and relative fallback.
 */
export function getApiUrl(path: string): string {
  const rawBase = process.env.NEXT_PUBLIC_API_URL || '';
  
  // Normalize base URL: strip trailing slashes
  let cleanBase = rawBase.trim().replace(/\/+$/, '');
  
  // If user accidentally set NEXT_PUBLIC_API_URL to ".../api", strip it to avoid double "/api/api"
  if (cleanBase.endsWith('/api')) {
    cleanBase = cleanBase.slice(0, -4);
  }
  
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // If cleanBase is empty (e.g. running on client without env or using Next.js proxy), return cleanPath
  if (!cleanBase) {
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      return `http://localhost:8000${cleanPath}`;
    }
    return cleanPath;
  }
  
  return `${cleanBase}${cleanPath}`;
}
