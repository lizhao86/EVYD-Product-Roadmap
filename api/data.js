import { put, get } from '@vercel/blob';

const BLOB_FILENAME = 'roadmap-data.json';

const EMPTY_DATA = {
  version: 0,
  lastModified: new Date().toISOString(),
  moduleOrder: [],
  pillarOrder: [],
  projectOrder: [],
  items: []
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readBlob() {
  // get() by pathname: returns null if not found, handles auth automatically
  const result = await get(BLOB_FILENAME, { access: 'private' });
  if (!result) return { ...EMPTY_DATA };
  const text = await result.text();
  return JSON.parse(text);
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    if (req.method === 'GET') {
      const data = await readBlob();
      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      const incoming = req.body;
      if (!incoming || typeof incoming.version !== 'number') {
        return res.status(400).json({ error: 'invalid payload' });
      }

      // Optimistic lock: check remote version
      const remote = await readBlob();
      if (incoming.version <= remote.version) {
        return res.status(409).json({
          error: 'conflict',
          remoteVersion: remote.version,
          message: '数据已被他人更新，请刷新页面获取最新版本。'
        });
      }

      // Write new version
      incoming.lastModified = new Date().toISOString();
      await put(BLOB_FILENAME, JSON.stringify(incoming), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      return res.status(200).json({ ok: true, version: incoming.version });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
