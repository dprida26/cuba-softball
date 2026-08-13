const { listAll, json } = require('./_lib');

const TABLE = process.env.AIRTABLE_PLAYERS_TABLE || 'Players';

function mapRecord(r) {
  const photo = r.fields.Photo && r.fields.Photo[0] ? r.fields.Photo[0].url : null;
  return {
    id: r.id,
    number: r.fields.Number || '-',
    name: r.fields.Name || '',
    photo
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    const records = await listAll(TABLE);
    const players = records.map(mapRecord).sort((a, b) => {
      const na = parseInt(a.number, 10);
      const nb = parseInt(b.number, 10);
      return (isNaN(na) ? 9999 : na) - (isNaN(nb) ? 9999 : nb);
    });
    return json(200, players);
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message });
  }
};
