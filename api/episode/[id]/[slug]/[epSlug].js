'use strict';

const config = require('../../../../lib/config');
const { guard } = require('../../../../lib/auth');
const { fetchPage, httpErrorFrom } = require('../../../../lib/client');
const { parseEpisode } = require('../../../../lib/parsers');

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const id = String(first(req.query.id) || '');
    const slug = String(first(req.query.slug) || '');
    const epSlug = String(first(req.query.epSlug) || '');

    if (!/^\d{1,10}$/.test(id)) {
      return res.status(400).json({ success: false, error: 'Parameter id harus angka' });
    }
    if (!/^[A-Za-z0-9._~-]{1,200}$/.test(slug)) {
      return res.status(400).json({ success: false, error: 'Parameter slug tidak valid' });
    }
    if (!/^[A-Za-z0-9._~-]{1,50}$/.test(epSlug)) {
      return res.status(400).json({ success: false, error: 'Parameter epSlug tidak valid' });
    }

    const url = config.BASE_URL + '/anime/' + id + '/' + slug + '/episode/' + epSlug;
    const $ = await fetchPage(url);
    const data = parseEpisode($, { id, slug, epSlug, url });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    const { status, message } = httpErrorFrom(err);
    return res.status(status).json({ success: false, error: message });
  }
};
