const { baseUrl, requireAdmin, json } = require('./_lib');

const TABLE = process.env.AIRTABLE_PLAYERS_TABLE || 'Players';
const CONTENT_API = 'https://content.airtable.com/v0';

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    requireAdmin(event);

    const { playerId, base64, contentType, filename } = JSON.parse(event.body || '{}');
    if (!playerId || !base64) return json(400, { error: 'Faltan datos de la foto' });

    // Clear the existing attachment first so re-uploading replaces it instead of appending
    await fetch(`${baseUrl(TABLE)}/${playerId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { Photo: [] } })
    });

    const uploadRes = await fetch(
      `${CONTENT_API}/${process.env.AIRTABLE_BASE_ID}/${playerId}/Photo/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contentType: contentType || 'image/jpeg',
          file: base64,
          filename: filename || 'foto.jpg'
        })
      }
    );

    const data = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      return json(uploadRes.status, { error: (data.error && data.error.message) || 'Error al subir la foto' });
    }

    const photo = data.fields && data.fields.Photo && data.fields.Photo[0] ? data.fields.Photo[0].url : null;
    return json(200, { photo });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message });
  }
};
