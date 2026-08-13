const { json } = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (password && password === process.env.ADMIN_PASSWORD) {
      return json(200, { ok: true });
    }
    return json(401, { ok: false, error: 'Contraseña incorrecta' });
  } catch (e) {
    return json(400, { error: 'Solicitud inválida' });
  }
};
