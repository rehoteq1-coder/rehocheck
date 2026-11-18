'use strict';

/**
 * Request validation. The browser is untrusted: never forward a raw body
 * to a provider.
 */

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details) this.details = details;
  }
}

const MAX_URL_LENGTH = 2048;
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;

/**
 * Accepts only absolute http(s) URLs with a real dotted host.
 * Returns the normalised URL string.
 */
function validateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'A "url" string is required');
  }

  const raw = value.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw new ApiError(400, `URL must be ${MAX_URL_LENGTH} characters or fewer`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(400, 'That is not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'Only http:// and https:// URLs can be scanned');
  }

  if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
    throw new ApiError(400, 'URL must include a domain name');
  }

  // Refuse to make the server fetch itself or internal infrastructure.
  if (PRIVATE_HOST.test(parsed.hostname)) {
    throw new ApiError(400, 'Private, loopback and link-local hosts cannot be scanned');
  }

  parsed.hash = '';
  return parsed.toString();
}

function validateHeadline(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'A "headline" string is required');
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < 5) throw new ApiError(400, 'Headline is too short to verify');
  if (text.length > 800) throw new ApiError(400, 'Headline must be 800 characters or fewer');
  return text;
}

function validateAnalysisId(value) {
  // VirusTotal analysis ids look like "ZGI0M...-1605..." (base64url-ish).
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(value)) {
    throw new ApiError(400, 'Invalid analysis id');
  }
  return value;
}

/** Wraps an async route so rejections reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, validateUrl, validateHeadline, validateAnalysisId, asyncHandler };
