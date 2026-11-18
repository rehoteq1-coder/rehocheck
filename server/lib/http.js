'use strict';

/**
 * Outbound HTTP helper with a hard timeout and one optional retry.
 * Every provider call must go through here so a hung upstream can never
 * leave a browser request open forever.
 */

const DEFAULT_TIMEOUT = 15000;

class UpstreamError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status || 502;
    this.body = body;
  }
}

async function fetchJson(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, retries = 0, ...init } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text.slice(0, 2000) };
        }
      }

      if (response.status === 429) {
        throw new UpstreamError('Upstream rate limit reached — try again in a moment', 503, data);
      }

      if (!response.ok) {
        const detail =
          (data && (data.error && (data.error.message || data.error) || data.message || data.error)) ||
          `Upstream responded ${response.status}`;
        throw new UpstreamError(
          typeof detail === 'string' ? detail : JSON.stringify(detail),
          response.status >= 500 ? 502 : response.status,
          data
        );
      }

      return data;
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new UpstreamError('Upstream request timed out', 504);
      }
      // Retry only transport failures / 5xx, never 4xx validation problems.
      const retryable = !(err instanceof UpstreamError) || err.status === 502 || err.status === 504;
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

module.exports = { fetchJson, UpstreamError };
