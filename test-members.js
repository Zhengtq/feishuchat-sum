import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf-8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if(k && !k.startsWith('#')) acc[k] = v.join('=').trim();
  return acc;
}, {});

const appId = env.FEISHU_APP_ID;
const appSecret = env.FEISHU_APP_SECRET;
const chatId = 'oc_17da8ab91ce6952e46cfbf220ab6a88b';

async function test() {
  const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const tokenData = await tokenResp.json();
  const token = tokenData.tenant_access_token;
  console.log('Token:', token ? 'Success' : tokenData);

  const url = `https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id&page_size=100`;
  const membersResp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  const mData = await membersResp.json();
  console.log('Members:', JSON.stringify(mData, null, 2));
}
test();
