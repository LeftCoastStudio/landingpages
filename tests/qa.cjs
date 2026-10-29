// QA uses Node's built-in test tools. No network or live Apify charges.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','public','app.js'),'utf8')
 .replace(/  initialize\(\);\s*\}\)\(\);\s*$/,`  globalThis.__ledgerTest={parseCSV,parseImportedItems,sourceIsPublic,dedupeImported,escapeHTML,csvCell,renderOverview,derive,encryptVault,decryptVault,setCryptKey(k){cryptKey=k;},setSalt(s){vaultSalt=s;},setState(s){state=s;}};
})();`);
const node={innerHTML:'',textContent:'',classList:{add(){},remove(){}}};
const context={
 crypto:webcrypto, TextEncoder, TextDecoder, indexedDB:{}, window:{isSecureContext:true},
 document:{getElementById:()=>node, addEventListener(){}},
 setTimeout,clearTimeout,console,URL,Uint8Array,btoa,atob,Intl,Date,Array,JSON,Map,Set,
};
vm.runInNewContext(src,context);
const {parseCSV,parseImportedItems,sourceIsPublic,dedupeImported,escapeHTML,csvCell,renderOverview,setState}=context.__ledgerTest;
assert.equal(escapeHTML('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
assert.ok(csvCell('=HYPERLINK(1)').startsWith('"\''));
assert.equal(sourceIsPublic('https://www.facebook.com/groups/777/posts/222'),false);
assert.equal(sourceIsPublic('https://www.instagram.com/p/ABC123/'),true);
assert.equal(sourceIsPublic('javascript:alert(1)'),false);
const csv='url,authorName,text\n"https://www.instagram.com/p/ABC/",example,"Hello, Napa"\n';
assert.equal(parseCSV(csv)[0].text,'Hello, Napa');
const samples=[
 {postUrl:'https://www.instagram.com/p/ABC/',authorName:'public_example',text:'Text from public post',postedAt:'2026-10-28T13:00:00-07:00'},
 {postUrl:'https://www.facebook.com/groups/private/posts/11',authorName:'user1',text:'Should be filtered'},
 {postUrl:'https://www.instagram.com/p/ABC/',authorName:'public_example',text:'Text from public post'},
];
const imported=parseImportedItems(samples);
assert.equal(imported.items.length,2);
assert.equal(imported.skipped,1);
assert.equal(dedupeImported(imported.items).length,1);
setState({items:[]});assert.ok(renderOverview().includes('A clear record. A calm response.'));
setState({items:[{...imported.items[0],author:'<script>alert(1)</script>',role:'unknown',shots:[]} ]});
const html=renderOverview();
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
console.log('Frontend QA: import, CSV, deduplication, private group exclusions, HTML escape, chart rendering PASS');
(async()=>{
 const salt=Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64');
 const key=await context.__ledgerTest.derive('long-test-password-99',salt);
 context.__ledgerTest.setCryptKey(key);context.__ledgerTest.setSalt(salt);
 const encrypted=await context.__ledgerTest.encryptVault(JSON.stringify({items:[{text:'Encrypted evidence here'}]}));
 assert.equal(encrypted.format,'tutu-vault-v1');
 assert.ok(!JSON.stringify(encrypted).includes('Encrypted evidence here'));
 const decrypted=await context.__ledgerTest.decryptVault(encrypted,key);
 assert.equal(decrypted.items[0].text,'Encrypted evidence here');
 let failed=false;try{const wrongKey=await context.__ledgerTest.derive('bad-password',salt);await context.__ledgerTest.decryptVault(encrypted,wrongKey);}catch{failed=true;}
 assert.ok(failed,'Wrong passphrase must not decrypt');
 console.log('Crypto QA: PBKDF2/AES-GCM round trip and wrong-key rejection PASS');
 const mod=await import('../netlify/functions/pull-public.mjs');
 const originalFetch=global.fetch;
 const env=process.env;
 Object.assign(env,{APIFY_TOKEN:'fake_token_for_test',APIFY_TASK_ID:'test~public-posts',TT_MONITOR_KEY:'a-long-test-sync-key',APIFY_ALLOWED_PUBLIC_HANDLES:'tumbleberrydance,tutu_tumble'});
 let fetched=false;
 global.fetch=async()=>{fetched=true;return {ok:true,json:async()=>[
   {postUrl:'https://www.instagram.com/p/ABC/',author:{username:'tumbleberrydance'},caption:'Public account post'},
   {postUrl:'https://www.instagram.com/p/ABC2/',author:{username:'someone_else'},caption:'Not on allowlist'},
   {postUrl:'https://www.facebook.com/groups/123/posts/123',author:{username:'tutu_tumble'},caption:'Private group excluded'},
 ]};};
 const unauthorized=await mod.handler({httpMethod:'GET',headers:{'x-monitor-key':'wrong'}});
 assert.equal(unauthorized.statusCode,401);assert.equal(fetched,false);
 const allowed=await mod.handler({httpMethod:'GET',headers:{'x-monitor-key':'a-long-test-sync-key'}});
 assert.equal(allowed.statusCode,200);
 const body=JSON.parse(allowed.body);
 assert.equal(body.items.length,1);assert.equal(body.scanned,3);
 assert.equal(body.items[0].authorName,'tumbleberrydance');
 const post=await mod.handler({httpMethod:'POST',headers:{'x-monitor-key':'a-long-test-sync-key'}});assert.equal(post.statusCode,405);
 global.fetch=originalFetch;
 console.log('Netlify API QA: access key, public allowlist, group exclusion, read-only GET PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
