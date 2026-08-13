const { baseUrl, airtableFetch, listAll, requireAdmin, json } = require('./_lib');

const TABLE = process.env.AIRTABLE_GAMES_TABLE || 'Games';

function mapRecord(r) {
  let playerStats = {};
  try {
    playerStats = r.fields.PlayerStats ? JSON.parse(r.fields.PlayerStats) : {};
  } catch (e) {
    playerStats = {};
  }
  let pitcherStats = {};
  try {
    pitcherStats = r.fields.PitcherStats ? JSON.parse(r.fields.PitcherStats) : {};
  } catch (e) {
    pitcherStats = {};
  }
  return {
    id: r.id,
    date: r.fields.Date || '',
    opponent: r.fields.Opponent || '',
    scoreUs: typeof r.fields.ScoreUs === 'number' ? r.fields.ScoreUs : 0,
    scoreThem: typeof r.fields.ScoreThem === 'number' ? r.fields.ScoreThem : 0,
    playerStats,
    pitcherStats
  };
}

function toFields(body) {
  return {
    Date: body.date,
    Opponent: body.opponent,
    ScoreUs: body.scoreUs,
    ScoreThem: body.scoreThem,
    PlayerStats: JSON.stringify(body.playerStats || {}),
    PitcherStats: JSON.stringify(body.pitcherStats || {})
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const records = await listAll(TABLE);
      return json(200, records.map(mapRecord));
    }

    if (event.httpMethod === 'POST') {
      requireAdmin(event);
      const body = JSON.parse(event.body || '{}');
      const data = await airtableFetch(baseUrl(TABLE), {
        method: 'POST',
        body: JSON.stringify({ fields: toFields(body) })
      });
      return json(200, mapRecord(data));
    }

    if (event.httpMethod === 'PATCH') {
      requireAdmin(event);
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return json(400, { error: 'Falta el id del partido' });
      const data = await airtableFetch(`${baseUrl(TABLE)}/${body.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: toFields(body) })
      });
      return json(200, mapRecord(data));
    }

    if (event.httpMethod === 'DELETE') {
      requireAdmin(event);
      const { id } = JSON.parse(event.body || '{}');
      if (!id) return json(400, { error: 'Falta el id del partido' });
      await airtableFetch(`${baseUrl(TABLE)}/${id}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message });
  }
};
