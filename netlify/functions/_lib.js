/* Shared helpers for talking to Airtable and gating admin writes. */

const AIRTABLE_API = 'https://api.airtable.com/v0';

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

function baseUrl(table) {
  return `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

async function airtableFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...airtableHeaders(), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || 'Error al conectar con Airtable');
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

async function listAll(table) {
  let records = [];
  let offset;
  do {
    const url = new URL(baseUrl(table));
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const data = await airtableFetch(url.toString());
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function requireAdmin(event) {
  const provided = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  if (!provided || provided !== process.env.ADMIN_PASSWORD) {
    const err = new Error('No autorizado');
    err.statusCode = 401;
    throw err;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

module.exports = { baseUrl, airtableFetch, listAll, requireAdmin, json };
