exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { password } = JSON.parse(event.body);

  const VIEWER = process.env.VIEWER_PASSWORD;
  const ADMIN  = process.env.ADMIN_PASSWORD;

  if (password === ADMIN) {
    return {
      statusCode: 200,
      body: JSON.stringify({ role: 'admin' })
    };
  } else if (password === VIEWER) {
    return {
      statusCode: 200,
      body: JSON.stringify({ role: 'viewer' })
    };
  } else {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Incorrect passcode' })
    };
  }
};
