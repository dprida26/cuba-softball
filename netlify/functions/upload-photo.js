const { baseUrl, requireAdmin, json } = require('./_lib');

const TABLE = process.env.AIRTABLE_PLAYERS_TABLE || 'Players';
const CONTENT_API = 'https://content.airtable.com/v0';

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    requireAdmin(event);

    const { playerId, base64, contentType, filename } = JSON.parse(event.body || '{}');
    if (!playerId || !base64) return json(400, { error: 'Faltan datos de la foto' });

    // Upload first (Airtable appends it), then drop any older attachments so
    // only the just-uploaded photo remains. Doing it in this order means a
    // failed cleanup never leaves the player without a photo.
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

    const attachments = (data.fields && data.fields.Photo) || [];
    const newest = attachments[attachments.length - 1];

    if (!newest) {
      return json(500, { error: 'La foto se subió pero Airtable no la devolvió' });
    }

    if (attachments.length > 1) {
      const cleanupRes = await fetch(`${baseUrl(TABLE)}/${playerId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { Photo: [{ id: newest.id }] } })
      });
      if (!cleanupRes.ok) {
        const cleanupData = await cleanupRes.json().catch(() => ({}));
        return json(cleanupRes.status, {
          error: (cleanupData.error && cleanupData.error.message) || 'Error al reemplazar la foto anterior'
        });
      }
    }

    return json(200, { photo: newest.url });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message });
  }
};
