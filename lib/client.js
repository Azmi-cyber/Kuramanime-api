'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

// Cache in-memory: Map<url, { data, expiresAt }>
// Catatan: di serverless cache hidup per-instance (hilang saat cold start).
const cache = new Map();
const MAX_CACHE_ENTRIES = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheGet(key) {
  if (!config.ENABLE_CACHE || config.CACHE_TTL_MS <= 0) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (!config.ENABLE_CACHE || config.CACHE_TTL_MS <= 0) return;
  const now = Date.now();
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }
  cache.set(key, { data, expiresAt: now + config.CACHE_TTL_MS });
}

function buildHeaders() {
  return {
    'User-Agent': config.USER_AGENT,
    Referer: config.REFERER,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  };
}

function buildError(err) {
  const status = err && err.response ? err.response.status : null;
  const timedOut =
    !!err &&
    (err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ERR_CANCELED' ||
      err.name === 'CanceledError' ||
      err.name === 'TimeoutError');
  let message;
  if (status) message = 'Sumber mengembalikan HTTP ' + status;
  else if (timedOut) message = 'Timeout saat mengambil data dari sumber';
  else message = 'Gagal mengambil data dari sumber: ' + (err && err.message ? err.message : 'unknown error');
  const e = new Error(message);
  e.status = status;
  e.timeout = timedOut;
  return e;
}

function isRetryable(err) {
  const status = err && err.response ? err.response.status : null;
  if (!status) return true; // network error / timeout
  return status >= 500 || status === 429 || status === 408;
}

/**
 * Ambil HTML dari URL (dengan cache + retry + deadline).
 * @param {string} url
 * @param {{deadline?: number}} [options] deadline = timestamp ms absolut
 * @returns {Promise<string>}
 */
async function fetchHtml(url, options) {
  const cached = cacheGet(url);
  if (cached !== null) return cached;

  const deadline = options && options.deadline ? options.deadline : Date.now() + config.TOTAL_BUDGET_MS;
  let lastError = null;

  for (let attempt = 0; attempt <= config.MAX_RETRY; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 400) break;
    const timeout = Math.min(config.REQUEST_TIMEOUT_MS, remaining);

    try {
      const response = await axios.get(url, {
        headers: buildHeaders(),
        timeout,
        signal: AbortSignal.timeout(timeout + 200),
        responseType: 'text',
        maxRedirects: 5,
        decompress: true,
        transformResponse: [(d) => d],
        validateStatus: (s) => s >= 200 && s < 300,
      });
      const html = typeof response.data === 'string' ? response.data : String(response.data || '');
      cacheSet(url, html);
      return html;
    } catch (err) {
      lastError = buildError(err);
      if (!isRetryable(err)) break;
      if (attempt < config.MAX_RETRY) {
        const waitMs = config.RETRY_DELAY_MS;
        if (deadline - Date.now() - waitMs < 400) break;
        await sleep(waitMs);
      }
    }
  }

  if (lastError) throw lastError;
  const e = new Error('Timeout saat mengambil data dari sumber');
  e.status = null;
  e.timeout = true;
  throw e;
}

/** Ambil halaman dan kembalikan instance cheerio ($). */
async function fetchPage(url, options) {
  const html = await fetchHtml(url, options);
  return cheerio.load(html);
}

/** Petakan error internal ke { status, message } untuk response JSON. */
function httpErrorFrom(err) {
  if (err && err.status === 404) return { status: 404, message: 'Halaman tidak ditemukan di sumber' };
  if (err && (err.status === 401 || err.status === 403)) {
    return { status: 502, message: 'Sumber menolak request (HTTP ' + err.status + '). Kemungkinan proteksi anti-bot atau IP diblokir.' };
  }
  if (err && err.timeout) return { status: 504, message: 'Timeout saat mengambil data dari sumber' };
  const message = err && err.message ? String(err.message).slice(0, 300) : 'Internal error';
  return { status: 502, message };
}

module.exports = { fetchHtml, fetchPage, httpErrorFrom };
