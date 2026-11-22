'use strict';

const crypto = require('crypto');
const config = require('./config');

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Cek header x-api-key. API_KEY kosong = auth dimatikan.
 * @returns {boolean} true kalau boleh lanjut; false kalau sudah mengirim 401.
 */
function authorize(req, res) {
  if (!config.API_KEY) return true;
  const header = req.headers['x-api-key'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided && safeEqual(provided, config.API_KEY)) return true;
  res.status(401).json({ success: false, error: 'Unauthorized: header x-api-key tidak ada atau tidak valid' });
  return false;
}

/**
 * Middleware gabungan, dipanggil di awal setiap handler:
 *   if (!guard(req, res)) return;
 * Mengurus CORS, preflight OPTIONS (204), method check, dan API key.
 */
function guard(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    res.status(405).json({ success: false, error: 'Method tidak diizinkan, gunakan GET' });
    return false;
  }
  return authorize(req, res);
}

module.exports = { guard, authorize, applyCors };
