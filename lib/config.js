'use strict';

/**
 * Satu-satunya pintu pembacaan process.env.
 * Semua file lain WAJIB require('./config') / require('../lib/config').
 */

// Untuk local dev: baca .env kalau ada. Di Vercel env sudah ter-inject, dotenv tidak menimpa.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv opsional
}

const DEFAULT_BASE_URL = 'https://v20.kuramanime.ing';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function readString(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return value === '' ? fallback : value;
}

function readInt(name, fallback, min, max) {
  const raw = readString(name, '');
  const parsed = parseInt(raw, 10);
  let value = Number.isFinite(parsed) ? parsed : fallback;
  if (typeof min === 'number' && value < min) value = min;
  if (typeof max === 'number' && value > max) value = max;
  return value;
}

function readBool(name, fallback) {
  const raw = readString(name, '').toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function normalizeBaseUrl(value) {
  let v = String(value).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(v)) v = DEFAULT_BASE_URL;
  return v;
}

const BASE_URL = normalizeBaseUrl(readString('BASE_URL', DEFAULT_BASE_URL));

const config = {
  BASE_URL,
  // Maks 9000 ms karena limit Vercel Hobby = 10 detik.
  REQUEST_TIMEOUT_MS: readInt('REQUEST_TIMEOUT_MS', 8000, 1000, 9000),
  MAX_RETRY: readInt('MAX_RETRY', 2, 0, 5),
  RETRY_DELAY_MS: readInt('RETRY_DELAY_MS', 500, 0, 5000),
  CACHE_TTL_MS: readInt('CACHE_TTL_MS', 300000, 0, 86400000),
  ENABLE_CACHE: readBool('ENABLE_CACHE', true),
  USER_AGENT: readString('USER_AGENT', DEFAULT_USER_AGENT),
  REFERER: readString('REFERER', BASE_URL + '/'),
  API_KEY: readString('API_KEY', ''),
  MAX_EPISODE_PAGES: readInt('MAX_EPISODE_PAGES', 10, 0, 30),
  TOTAL_BUDGET_MS: readInt('TOTAL_BUDGET_MS', 9000, 2000, 9500),
};

module.exports = Object.freeze(config);
