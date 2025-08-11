import axios from 'axios';

function envMS(key){ return process.env[`MS_${key}`]; }

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('client_id', envMS('CLIENT_ID'));
  params.append('client_secret', envMS('CLIENT_SECRET'));
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', process.env.MS_REFRESH_TOKEN);
  params.append('scope', process.env.MS_SCOPES);

  const { data } = await axios.post(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, params);
  return data.access_token;
}

export async function uploadBufferToOneDrive(path, buffer) {
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(path)}:/content`;
  await axios.put(url, buffer, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream'
    },
    maxBodyLength: Infinity
  });
}
