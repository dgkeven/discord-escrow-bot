import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

export function verifyWebhook({ url, headers, body }, secret) {
  const ids=url.searchParams.getAll('data.id');
  const id=ids[0];
  const signature=headers['x-signature'];
  const requestId=headers['x-request-id'];
  if(ids.length!==1 || !/^\d{1,30}$/.test(id || '') || typeof signature!=='string' || typeof requestId!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId))return null;
  if(body?.type!=='payment' || String(body?.data?.id)!==id)return null;
  const parts=signature.split(',').map(p=>p.trim().split('='));
  if(parts.some(p=>p.length!==2) || parts.filter(p=>p[0]==='ts').length!==1 || parts.filter(p=>p[0]==='v1').length!==1)return null;
  const values=Object.fromEntries(parts), ts=values.ts, digest=values.v1;
  if(!/^\d{10,16}$/.test(ts || '') || !/^[a-fA-F0-9]{64}$/.test(digest || ''))return null;
  const manifest=`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected=createHmac('sha256',secret).update(manifest).digest();
  if(!timingSafeEqual(expected,Buffer.from(digest,'hex')))return null;
  // No short timestamp TTL: provider retries can arrive hours later. The durable
  // inbox deduplicates signed deliveries and the worker always reads current API data.
  return { paymentId:id, eventId:createHash('sha256').update(manifest).update(digest.toLowerCase()).digest('hex') };
}
