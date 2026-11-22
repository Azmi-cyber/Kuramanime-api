'use strict';

const config = require('../../../lib/config');
const { guard } = require('../../../lib/auth');
const { fetchPage, httpErrorFrom } = require('../../../lib/client');
const { parseDetail, parseEpisodeList, mergeEpisodes, findEpisodePageUrls } = require('../../../lib/parsers');

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const id = String(first(req.query.id) || '');
    const slug = String(first(req.query.slug) || '');

    if (!/^\d{1,10}$/.test(id)) {
      return res.status(400).json({ success: false, error: 'Parameter id harus angka' });
    }
    if (!/^[A-Za-z0-9._~-]{1,200}$/.test(slug)) {
      return res.status(400).json({ success: false, error: 'Parameter slug tidak valid' });
    }

    const deadline = Date.now() + config.TOTAL_BUDGET_MS;
    const url = config.BASE_URL + '/anime/' + id + '/' + slug;

    const $ = await fetchPage(url, { deadline });
    const data = parseDetail($, { id, slug });

    // Daftar episode bisa dipecah per halaman (pagination); ambil semua halaman tambahan.
    if (config.MAX_EPISODE_PAGES > 0) {
      const pageUrls = findEpisodePageUrls($, url).slice(0, config.MAX_EPISODE_PAGES);
      if (pageUrls.length) {
        const results = await Promise.allSettled(pageUrls.map((u) => fetchPage(u, { deadline })));
        for (const r of results) {
          if (r.status === 'fulfilled') {
            data.episodes = mergeEpisodes(data.episodes, parseEpisodeList(r.value, id));
          }
        }
      }
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    const { status, message } = httpErrorFrom(err);
    return res.status(status).json({ success: false, error: message });
  }
};
