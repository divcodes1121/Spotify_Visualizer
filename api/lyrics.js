// Vercel serverless function: GET /api/lyrics?track=&artist=&album=&duration=
const { findLyrics } = require('../lib/proxies');

module.exports = async (req, res) => {
  const { status, body, cacheable } = await findLyrics(req.query || {});
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheable ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'no-store');
  res.status(status).send(JSON.stringify(body));
};
