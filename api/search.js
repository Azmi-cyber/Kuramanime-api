'use strict';

const config = require('../lib/config');
const { guard } = require('../lib/auth');
const { fetchPage, httpErrorFrom } = require('../lib/client');
const { parseSearch } = require('../lib/parsers');

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const q = String(first(req.query.q) || '').trim();
    if (!q) {
      return res.status(400).json({ success: false, error: 'Parameter q wajib diisi, contoh: /api/search?q=one+piece' });
    }
    if (q.length > 100) {
      return res.status(400).json({ success: false, error: 'Parameter q maksimal 100 karakter' });
    }

    const params = new URLSearchParams();
    params.set('search', q);

    const orderBy = first(req.query.order_by);
    if (orderBy !== undefined && orderBy !== '') {
      if (!/^[a-zA-Z0-9_-]{1,30}$/.test(String(orderBy))) {
        return res.status(400).json({ success: false, error: 'Parameter order_by tidak valid' });
      }
      params.set('order_by', String(orderBy));
    }

    const page = first(req.query.page);
    if (page !== undefined && page !== '') {
      if (!/^\d{1,4}$/.test(String(page))) {
        return res.status(400).json({ success: false, error: 'Parameter page harus angka' });
      }
      params.set('page', String(page));
    }

    const $ = await fetchPage(config.BASE_URL + '/anime?' + params.toString());
    const data = parseSearch($);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    const { status, message } = httpErrorFrom(err);
    return res.status(status).json({ success: false, error: message });
  }
};
