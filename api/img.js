// Vercel serverless function: GET /api/img?url=<Spotify CDN image> (same-origin copy for color extraction)
const { fetchArt } = require('../lib/proxies');

module.exports = async (req, res) => {
  const r = await fetchArt((req.query || {}).url);
  if (r.error) {
    res.status(r.status).send(r.error);
    return;
  }
  res.setHeader('Content-Type', r.type);
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
  res.status(200).send(r.buffer);
};
