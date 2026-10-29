/** Optional read-only Netlify bridge to an already-completed Apify task dataset.
 *  Never triggers a scraper, bypasses logins, identifies anonymous users, or stores records.
 *  Requires an access key and a strict allowlist of publicly visible brand account handles.
 */
import { timingSafeEqual } from 'node:crypto';

const response = (statusCode, payload) => ({
  statusCode,
  headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff'},
  body: JSON.stringify(payload),
});
const canonicalHandle = s => String(s||'').trim().replace(/^@/,'').toLowerCase();
const read = (obj,paths) => { for(const path of paths){let v=path.split('.').reduce((p,key)=>p && p[key],obj);if(typeof v==='string' && v.trim()) return v.trim();if(typeof v==='number')return String(v);}return '';};
function isPublicMetaUrl(link){
  try{
    const u=new URL(link);
    if(u.protocol!=='https:')return false;
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    if(!['instagram.com','facebook.com','m.facebook.com','web.facebook.com','fb.watch'].includes(host))return false;
    if(/(^|\/)groups\//.test(u.pathname.toLowerCase()))return false;
    return true;
  }catch{return false;}
}
function secureEqual(a,b){
  if(!a || !b)return false;
  const x=Buffer.from(a);const y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
export const handler = async (event) => {
  if(event.httpMethod!=='GET')return response(405,{error:'GET required'});
  const token=process.env.APIFY_TOKEN;
  const taskId=process.env.APIFY_TASK_ID;
  const accessKey=process.env.TT_MONITOR_KEY;
  const handles=(process.env.APIFY_ALLOWED_PUBLIC_HANDLES||'').split(',').map(canonicalHandle).filter(Boolean);
  const prefixList=(process.env.APIFY_ALLOWED_PUBLIC_POST_PREFIXES||'').split(',').map(s=>s.trim()).filter(u=>isPublicMetaUrl(u));
  if(!token||!taskId||!accessKey || (!handles.length && !prefixList.length))return response(503,{error:'Sync not configured. Set the Netlify environment variables in README.'});
  if(!secureEqual(event.headers['x-monitor-key'] || event.headers['X-Monitor-Key'],accessKey))return response(401,{error:'Invalid monitor access key'});
  if(!/^[A-Za-z0-9_~.-]{3,120}$/.test(taskId))return response(500,{error:'Invalid Apify task ID configuration'});
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),18000);
    let upstream;
    try {
      upstream=await fetch(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(taskId)}/runs/last/dataset/items?status=SUCCEEDED&format=json&clean=true&limit=150`,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:controller.signal,
      });
    } finally {clearTimeout(timer);}
    if(!upstream.ok) return response(502,{error:`Apify returned status ${upstream.status}. Check your task ID and token.`});
    const dataset=await upstream.json();
    if(!Array.isArray(dataset))return response(502,{error:'Apify did not return an item array.'});
    const safeItems=[];
    for(const row of dataset){
      if(!row || typeof row!=='object')continue;
      const url=read(row,['postUrl','postURL','post_url','postLink','url','link','permalink']);
      if(!isPublicMetaUrl(url))continue;
      const author=read(row,['author.username','author.userName','author.name','owner.username','user.username','username','userName','authorName','profileName','pageName','accountName','author','name']);
      const normalized=canonicalHandle(author);
      const matchedHandle=handles.some(h=>h===normalized || h===normalized.replace(/^.*\//,''));
      const matchedUrl=prefixList.some(prefix=>url.startsWith(prefix));
      if(!matchedHandle && !matchedUrl)continue;
      const text=read(row,['caption','text','message','postText','content','description','commentText']);
      if(!text && !author)continue;
      safeItems.push({postUrl:url,authorName:author.slice(0,200),text:text.slice(0,10000),postedAt:read(row,['timestamp','createdAt','postedAt','publishedAt','date','time'])});
      if(safeItems.length>=100)break;
    }
    return response(200,{items:safeItems,count:safeItems.length,scanned:dataset.length,source:'Last successful Apify task run (public allowlist only)'});
  }catch(err){return response(502,{error:err.name==='AbortError'?'Apify request timed out. Try again.':'Unable to retrieve the Apify dataset.'});}
};
