const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const root=path.join(__dirname,'..');
test('responsive registries resolve real photographs with separate grid and detail resources',async()=>{
 const registry=require('../data/collect_images/responsive.json');const manifest=require('../data/collect_images/manifest.json');
 const {imageVariants}=require('../backend/domains/collect/image-urls');
 assert.ok(Object.keys(registry).length>5800);
 const samples=[Object.values(manifest).find(c=>c.source==='google-street-view'),manifest['monument:Tour Eiffel'],Object.values(manifest).find(c=>c.source==='panoramax'),Object.entries(manifest).find(([key])=>key.startsWith('bus:'))?.[1]].filter(Boolean);
 for(const entry of samples){const result=imageVariants(entry.image,{versioned:false});assert.notEqual(result.image_thumbnail,result.image_reference);for(const url of Object.values(result))assert.ok(fs.existsSync(path.join(root,url)));const original=await sharp(path.join(root,entry.image)).metadata(),thumb=await sharp(path.join(root,result.image_thumbnail)).metadata();assert.ok(thumb.width<=320);assert.ok(Math.abs(thumb.width/thumb.height-original.width/original.height)<.02);assert.ok(fs.statSync(path.join(root,result.image_thumbnail)).size<fs.statSync(path.join(root,entry.image)).size);assert.ok(entry.author&&entry.license);}
 const explorer=require('../data/explorer_images/manifest.json');assert.equal(explorer.images.length,12);assert.ok(explorer.images.some(entry=>entry.detail!==entry.url));for(const entry of explorer.images)assert.equal(entry.source,'Google Street View');for(const entry of explorer.images){assert.equal(imageVariants(entry.url,{versioned:false}).image_reference,entry.detail);assert.ok(fs.existsSync(path.join(root,entry.detail)));assert.ok(fs.existsSync(path.join(root,entry.thumbnail)));}
 const url=imageVariants(samples[0].image).image_thumbnail;assert.match(url,/\?v=[a-f0-9]{16}$/);
});
test('future Daily targets remain continuous, photographed and covered by geographic evidence',()=>{
 const {parseCsv}=require('../scripts/check_player_content');const raw=fs.readFileSync(path.join(root,'data/daily_images/manifest_next_30.csv'),'utf8');assert.equal(raw,fs.readFileSync(path.join(root,'backend/data/daily_images/manifest_next_30.csv'),'utf8'));
 const [, ...rows]=parseCsv(raw);assert.equal(rows.at(-1)[0],'2027-12-31');assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
 const receipts=new Map(require('../data/daily_images/geography-audit-20261014.json').entries.map(r=>[r.date,r]));const future=rows.filter(r=>r[0]>'2027-06-27');assert.equal(future.length,187);assert.equal(new Set(future.map(r=>r[1])).size,187);
 for(let i=1;i<rows.length;i++){const date=new Date(rows[i-1][0]+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);assert.equal(rows[i][0],date.toISOString().slice(0,10));}
 const originalNames=new Set(rows.filter(r=>r[0]<='2027-06-27').map(r=>r[1]));for(const [date,name,,file]of future){assert.ok(!originalNames.has(name));assert.ok(fs.existsSync(path.join(root,'data/daily_images',file)));const receipt=receipts.get(date);assert.equal(receipt.street,name);assert.ok(receipt.panoId&&receipt.visualReview&&receipt.sha256&&receipt.sourceImage);}
 const {extendCalendar}=require('../scripts/extend_verified_daily_calendar');assert.deepEqual(extendCalendar('2027-12-31'),{added:0,through:'2027-12-31'});assert.throws(()=>extendCalendar('invalid'),/Invalid calendar/);
});
