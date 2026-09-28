import { createServer } from 'node:http';
import { verifyWebhook } from './webhook.js';

export function createWebhookServer({ store, config, ready=()=>true }) {
  let bucket=200, last=Date.now();
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    const reply=(status,data={})=>{res.writeHead(status);res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET' && url.pathname==='/healthz') {
        const health=store.health();
        return reply(ready() && !health.failingJobs?200:503,{ready:ready(),...health});
      }
      if(req.method!=='POST' || url.pathname!=='/webhooks/mercadopago')return reply(404);
      const now=Date.now();bucket=Math.min(200,bucket+(now-last)*0.1);last=now;
      if(bucket<1){req.resume();return reply(429);} bucket--;
      if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){req.resume();return reply(415);}
      let length=0;const chunks=[];
      for await(const chunk of req) {
        length+=chunk.length;
        if(length>16384){reply(413);req.resume();return;}
        chunks.push(chunk);
      }
      let body;
      try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400);}
      const event=verifyWebhook({url,headers:req.headers,body},config.webhookSecret);
      if(!event)return reply(401);
      // FULL synchronous SQLite commit happens before acknowledgment.
      store.enqueue(event.eventId,event.paymentId);
      return reply(200,{received:true});
    }catch{
      console.error(JSON.stringify({event:'webhook_failed'}));
      if(!res.headersSent)reply(503);
      else res.end();
    }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  return server;
}
