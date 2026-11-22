'use strict';

const config = require('../lib/config');
const { guard } = require('../lib/auth');
const { fetchPage, httpErrorFrom } = require('../lib/client');
const { parseHome } = require('../lib/parsers');

module.exports = async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const $ = await fetchPage(config.BASE_URL + '/');
    const data = parseHome($);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    const { status, message } = httpErrorFrom(err);
    return res.status(status).json({ success: false, error: message });
  }
};
