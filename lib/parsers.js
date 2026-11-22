'use strict';

const cheerio = require('cheerio');
const config = require('./config');

const ANIME_URL_RE = /\/anime\/(\d+)\/([^/?#\s"']+)/i;
const EPISODE_URL_RE = /\/anime\/(\d+)\/([^/?#\s"']+)\/episode\/([^/?#\s"']+)/i;
const POSTER_ATTRS = ['data-setbg', 'data-src', 'data-original', 'data-lazy-src', 'data-bg', 'src'];
const EMBED_ATTRS = ['data-content', 'data-bs-content', 'data-html', 'data-original-title'];

const ITEM_SELECTORS = [
  '.product__item',
  '.anime__item',
  '.product__sidebar__view__item',
  '.anime-card',
  '.card-anime',
  '.film_list-wrap .flw-item',
  '.listupd .bs',
  'article.animposx',
].join(', ');

const TITLE_SELECTORS = [
  '.product__item__text h5 a',
  '.product__item__text h5',
  '.product__item__text h4',
  '.product__item__text .title',
  'h5 a',
  'h5',
  'h4 a',
  'h4',
  'h3 a',
  'h3',
  '.title',
  '.name',
];

const TYPE_RE = /^(TV Special|TV|Movie|OVA|ONA|ONI|Special|Music|CM|PV)$/i;
const STATUS_RE =
  /^(Finished Airing|Currently Airing|Not Yet Aired|Selesai Tayang|Sedang Tayang|Belum Tayang|Ongoing|Completed|Finished|Airing|Selesai|Tamat)$/i;

/* ------------------------------------------------------------------ */
/* Helper umum                                                         */
/* ------------------------------------------------------------------ */

function clean(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

function absUrl(href) {
  const h = clean(href);
  if (!h) return null;
  if (/^(javascript:|#|mailto:|data:|about:)/i.test(h)) return null;
  try {
    return new URL(h, config.BASE_URL + '/').href;
  } catch (_) {
    return null;
  }
}

function looksLikeUrl(value) {
  return !!value && /^(https?:)?\/\//i.test(value.trim());
}

function metaContent($, selector) {
  return clean($(selector).first().attr('content'));
}

function stripSiteSuffix(text) {
  if (!text) return null;
  return clean(text.replace(/\s*[-|–—]\s*Kuramanime.*$/i, ''));
}

/** Coba selector berurutan (prioritas), kembalikan teks non-kosong pertama. */
function firstText($, $scope, selectors) {
  for (const sel of selectors) {
    let text = null;
    try {
      text = clean($scope.find(sel).first().text());
    } catch (_) {
      text = null;
    }
    if (text) return text;
  }
  return null;
}

function extractPoster($, $scope) {
  if (!$scope || !$scope.length) return null;
  const nodes = $scope.find('*').addBack().toArray();
  for (const attr of POSTER_ATTRS) {
    for (const node of nodes) {
      if (attr === 'src' && node.name !== 'img') continue;
      const v = clean($(node).attr(attr));
      if (v && !/^data:/i.test(v)) {
        const u = absUrl(v);
        if (u) return u;
      }
    }
  }
  for (const node of nodes) {
    const style = $(node).attr('style');
    if (style) {
      const m = style.match(/url\((['"]?)(.*?)\1\)/i);
      if (m && m[2]) {
        const u = absUrl(m[2]);
        if (u) return u;
      }
    }
  }
  return null;
}

function matchAnime(href) {
  const h = clean(href);
  if (!h) return null;
  const m = h.match(ANIME_URL_RE);
  if (!m) return null;
  return { id: m[1], slug: m[2] };
}

function splitList(value) {
  if (!value) return [];
  return value
    .split(/[,;/]/)
    .map(clean)
    .filter(Boolean);
}

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

/** Load HTML tersembunyi di atribut data-content dsb (dipakai Bootstrap popover/dropdown). */
function embeddedDocs($) {
  const docs = [];
  $('[data-content], [data-bs-content], [data-html], [data-original-title]').each((_, el) => {
    for (const attr of EMBED_ATTRS) {
      const v = $(el).attr(attr);
      if (v && /<a[\s>]/i.test(v)) docs.push(cheerio.load(v));
    }
  });
  return docs;
}

/* ------------------------------------------------------------------ */
/* List anime (home & search)                                          */
/* ------------------------------------------------------------------ */

function findAnimeLink($, $item) {
  let found = null;
  $item
    .find('a[href]')
    .addBack('a[href]')
    .each((_, a) => {
      const m = matchAnime($(a).attr('href'));
      if (m) {
        found = { el: a, id: m.id, slug: m.slug };
        return false;
      }
      return undefined;
    });
  return found;
}

function extractTypeStatus($, $item) {
  let type = clean($item.attr('data-type'));
  let status = clean($item.attr('data-status'));
  const texts = [];
  $item.find('ul li, .ep, .view-end, .badge, .tag, .type, .status, span, small, a').each((_, e) => {
    const t = clean($(e).text());
    if (t && t.length <= 40) texts.push(t.replace(/^(tipe|type|status)\s*[:：]\s*/i, ''));
  });
  for (const t of texts) {
    if (!type && TYPE_RE.test(t)) type = t;
    if (!status && STATUS_RE.test(t)) status = t;
    if (type && status) break;
  }
  return { type: type || null, status: status || null };
}

function buildItem($, $item, link, withMeta) {
  const $link = $(link.el);
  const title =
    firstText($, $item, TITLE_SELECTORS) ||
    clean($link.attr('title')) ||
    clean($item.find('img').first().attr('alt')) ||
    clean($link.text());

  const item = {
    title: title || null,
    slug: link.slug,
    poster: extractPoster($, $item),
    url: config.BASE_URL + '/anime/' + link.id + '/' + link.slug,
  };
  if (withMeta) {
    const meta = extractTypeStatus($, $item);
    item.type = meta.type;
    item.status = meta.status;
  }
  item.id = link.id;
  return item;
}

function collectAnimeItems($, withMeta) {
  const results = [];
  const seen = new Set();

  const add = (item) => {
    const key = item.id + '/' + item.slug;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  $(ITEM_SELECTORS).each((_, el) => {
    const $item = $(el);
    const link = findAnimeLink($, $item);
    if (!link) return;
    add(buildItem($, $item, link, withMeta));
  });

  if (!results.length) {
    // Fallback: semua link /anime/<id>/<slug> yang punya gambar atau atribut title
    $('a[href]').each((_, a) => {
      const $a = $(a);
      const m = matchAnime($a.attr('href'));
      if (!m) return;
      const hasImg = $a.find('img, [data-setbg]').length > 0 || $a.attr('data-setbg');
      if (!hasImg && !clean($a.attr('title'))) return;
      const $scope = hasImg ? $a : $a.parent();
      add(buildItem($, $scope, { el: a, id: m.id, slug: m.slug }, withMeta));
    });
  }

  return results;
}

function parseHome($) {
  return collectAnimeItems($, false);
}

function parseSearch($) {
  return collectAnimeItems($, true);
}

/* ------------------------------------------------------------------ */
/* Detail anime                                                        */
/* ------------------------------------------------------------------ */

function buildInfoMap($) {
  const entries = [];
  const scopes = [
    '.anime__details__widget li',
    '.anime__details__content li',
    '.anime__details__text li',
    '.anime__details li',
  ];
  for (const sel of scopes) {
    $(sel).each((_, li) => {
      const $li = $(li);
      if ($li.find('li').length) return;
      const label = clean($li.find('span, b, strong, .label').first().text());
      if (!label) return;
      const $copy = $li.clone();
      $copy.find('span, b, strong, .label').first().remove();
      const rawValue = clean($copy.text());
      const value = rawValue ? clean(rawValue.replace(/^[:：]\s*/, '')) : null;
      const links = [];
      $li.find('a').each((__, a) => {
        const t = clean($(a).text());
        if (t) links.push(t);
      });
      entries.push({ key: label.replace(/[:：]\s*$/, '').toLowerCase(), value, links });
    });
    if (entries.length) break;
  }
  return entries;
}

function lookup(entries, re) {
  return entries.find((e) => re.test(e.key)) || null;
}

function entryText(entry) {
  if (!entry) return null;
  if (entry.links.length) return entry.links.join(', ');
  return entry.value || null;
}

function sortEpisodes(list) {
  return list.sort((a, b) => {
    const an = typeof a.number === 'number' ? a.number : Infinity;
    const bn = typeof b.number === 'number' ? b.number : Infinity;
    if (an !== bn) return an - bn;
    return String(a.slug).localeCompare(String(b.slug), undefined, { numeric: true });
  });
}

/**
 * Parse daftar episode dari halaman detail (termasuk HTML tersembunyi di data-content
 * dan URL episode yang muncul di inline script). Hanya episode milik animeId.
 */
function parseEpisodeList($, animeId) {
  const store = new Map();

  const add = (href, text) => {
    const h = clean(href);
    if (!h) return;
    const m = h.match(EPISODE_URL_RE);
    if (!m) return;
    if (animeId && m[1] !== String(animeId)) return;
    const epSlug = m[3];
    const label = clean(text);

    let number = /^\d+(\.\d+)?$/.test(epSlug) ? Number(epSlug) : null;
    if (number === null && label) {
      const n = label.match(/(\d+(?:\.\d+)?)/);
      if (n) number = Number(n[1]);
    }

    const prev = store.get(epSlug);
    if (prev && (prev.hasText || !label)) return;

    store.set(epSlug, {
      hasText: !!label,
      entry: {
        number,
        title: label || 'Episode ' + epSlug,
        slug: epSlug,
        url: config.BASE_URL + '/anime/' + m[1] + '/' + m[2] + '/episode/' + epSlug,
      },
    });
  };

  const docs = [$].concat(embeddedDocs($));
  for (const doc of docs) {
    doc('a[href]').each((_, a) => add(doc(a).attr('href'), doc(a).text()));
  }

  if (animeId) {
    const re = new RegExp('/anime/' + animeId + '/([^/"\'\\s\\\\]+)/episode/([^/"\'\\s\\\\?#]+)', 'g');
    $('script').each((_, s) => {
      const raw = $(s).html();
      if (!raw) return;
      const text = raw.replace(/\\\//g, '/');
      let m;
      while ((m = re.exec(text)) !== null) {
        add('/anime/' + animeId + '/' + m[1] + '/episode/' + m[2], null);
      }
    });
  }

  return sortEpisodes(Array.from(store.values()).map((v) => v.entry));
}

function mergeEpisodes(a, b) {
  const map = new Map();
  for (const ep of (a || []).concat(b || [])) {
    if (!map.has(ep.slug)) map.set(ep.slug, ep);
  }
  return sortEpisodes(Array.from(map.values()));
}

/** URL halaman tambahan (pagination) untuk daftar episode pada path anime yang sama. */
function findEpisodePageUrls($, pageUrl) {
  let basePath;
  try {
    basePath = new URL(pageUrl).pathname.replace(/\/+$/, '');
  } catch (_) {
    return [];
  }
  const urls = new Set();
  const docs = [$].concat(embeddedDocs($));
  for (const doc of docs) {
    doc('a[href*="page="]').each((_, a) => {
      const u = absUrl(doc(a).attr('href'));
      if (!u) return;
      try {
        const parsed = new URL(u);
        if (parsed.pathname.replace(/\/+$/, '') !== basePath) return;
        if (parsed.searchParams.get('page') === '1') return;
        if (u === pageUrl) return;
        urls.add(u);
      } catch (_) {
        // abaikan URL rusak
      }
    });
  }
  return Array.from(urls);
}

function parseDetail($, params) {
  const id = params && params.id ? String(params.id) : null;
  const slug = params && params.slug ? String(params.slug) : null;

  const title =
    stripSiteSuffix(firstText($, $.root(), ['.anime__details__title h3', '.anime__details__title h2', 'h1', '.anime__details__title'])) ||
    stripSiteSuffix(metaContent($, 'meta[property="og:title"]')) ||
    stripSiteSuffix($('title').first().text());

  let poster = extractPoster($, $('.anime__details__pic').first());
  if (!poster) poster = absUrl(metaContent($, 'meta[property="og:image"]'));

  const synopsis =
    clean($('#synopsisField').first().text()) ||
    firstText($, $.root(), ['.anime__details__text p', '.anime__details__content p']) ||
    metaContent($, 'meta[name="description"]') ||
    metaContent($, 'meta[property="og:description"]');

  const info = buildInfoMap($);

  let genres = [];
  const genreEntry = lookup(info, /genre/);
  if (genreEntry) genres = genreEntry.links.length ? genreEntry.links : splitList(genreEntry.value);
  if (!genres.length) {
    $('.anime__details__content, .anime__details__widget, .anime__details')
      .find('a[href*="/properties/genre"], a[href*="/genre/"], a[href*="genre="]')
      .each((_, a) => {
        const t = clean($(a).text());
        if (t) genres.push(t);
      });
  }
  genres = uniq(genres);

  const status = entryText(lookup(info, /status/));
  const studio = entryText(lookup(info, /studio/));

  let year = null;
  for (const entry of info.filter((e) => /musim|season|tayang|aired|rilis|tahun|year|premiered/.test(e.key))) {
    const m = (entry.value || entry.links.join(' ')).match(/\b(19|20)\d{2}\b/);
    if (m) {
      year = Number(m[0]);
      break;
    }
  }
  if (year === null) {
    const m = clean($('a[href*="/properties/season"]').first().text());
    const y = m ? m.match(/\b(19|20)\d{2}\b/) : null;
    if (y) year = Number(y[0]);
  }

  const rating =
    entryText(lookup(info, /skor|score|rating/)) ||
    firstText($, $.root(), ['.anime__details__rating .text', '.anime__details__rating', '.rating']);

  return {
    title: title || null,
    slug,
    poster: poster || null,
    synopsis: synopsis || null,
    genres,
    status: status || null,
    studio: studio || null,
    year,
    rating: rating || null,
    episodes: parseEpisodeList($, id),
  };
}

/* ------------------------------------------------------------------ */
/* Halaman nonton                                                      */
/* ------------------------------------------------------------------ */

function parseServers($) {
  const servers = [];
  const seen = new Set();

  const push = (name, embed) => {
    const embedUrl = embed ? absUrl(embed) : null;
    const key = (embedUrl || '') + '|' + (name || '');
    if (seen.has(key)) return;
    seen.add(key);
    servers.push({ name: name || 'Server ' + (servers.length + 1), embed_url: embedUrl });
  };

  // 1) Dropdown pemilih server
  $('#changeServer option, select[name="server"] option, select#server option, select.server-select option, .server-select option').each(
    (_, o) => {
      const $o = $(o);
      const name = clean($o.text());
      const value = clean($o.attr('value'));
      if (!name && !value) return;
      if (!value && /pilih|select|choose/i.test(name || '')) return;
      push(name || value, looksLikeUrl(value) || (value && value.charAt(0) === '/') ? value : null);
    }
  );

  // 2) Iframe player
  $('iframe').each((_, f) => {
    const $f = $(f);
    const src = clean($f.attr('src')) || clean($f.attr('data-src')) || clean($f.attr('data-lazy-src'));
    if (!src) return;
    if (/^about:/i.test(src)) return;
    if (/facebook\.com\/plugins|disqus|googletagmanager|recaptcha|doubleclick|adsbygoogle/i.test(src)) return;
    push(clean($f.attr('title')), src);
  });

  // 3) Tag <video> / <source>
  $('video source[src], video[src]').each((_, v) => {
    const $v = $(v);
    const src = clean($v.attr('src'));
    if (!src) return;
    const size = clean($v.attr('size'));
    push(clean($v.attr('title')) || clean($v.attr('label')) || (size ? size + 'p' : null), src);
  });

  // 4) Atribut data-* eksplisit
  $('[data-embed], [data-embed-url], [data-video], [data-server-url]').each((_, el) => {
    const $el = $(el);
    const url =
      clean($el.attr('data-embed')) ||
      clean($el.attr('data-embed-url')) ||
      clean($el.attr('data-video')) ||
      clean($el.attr('data-server-url'));
    if (!url || !looksLikeUrl(url)) return;
    push(clean($el.attr('data-name')) || clean($el.text()), url);
  });

  // 5) Link server di container umum
  $('.anime__video__servers a[href], #server-list a[href], .server-list a[href], .servers a[href], .server a[href]').each((_, a) => {
    const href = clean($(a).attr('href'));
    if (!href || !looksLikeUrl(href)) return;
    push(clean($(a).text()), href);
  });

  return servers;
}

function parseEpisode($, params) {
  const epSlug = params && params.epSlug ? String(params.epSlug) : null;

  const title =
    stripSiteSuffix(
      firstText($, $.root(), ['.anime__details__title h3', '#episodeTitle', 'h1', '.breadcrumb__links span:last-child'])
    ) ||
    stripSiteSuffix(metaContent($, 'meta[property="og:title"]')) ||
    stripSiteSuffix($('title').first().text());

  let episodeNumber = epSlug && /^\d+(\.\d+)?$/.test(epSlug) ? Number(epSlug) : null;
  if (episodeNumber === null && title) {
    const m = title.match(/(?:episode|eps?)\s*(\d+(?:\.\d+)?)/i);
    if (m) episodeNumber = Number(m[1]);
  }

  return {
    title: title || null,
    episode_number: episodeNumber,
    servers: parseServers($),
  };
}

module.exports = {
  parseHome,
  parseSearch,
  parseDetail,
  parseEpisode,
  parseEpisodeList,
  mergeEpisodes,
  findEpisodePageUrls,
};
