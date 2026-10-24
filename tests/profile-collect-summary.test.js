const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const renderer=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../src/public/js/collect-profile-summary.js')).toString('base64'));
const {createProfileRepository}=require('../backend/domains/profiles/repository');
const {publicRules}=require('../backend/domains/site-shell/public-rules');
test('Collect summary distinguishes an unplayed private collection from measured failure',async()=>{
 const {renderCollectProfileSummary:render}=await renderer;
 const html=render({unique_cards:0,total_copies:0,active_unique_cards:0,active_card_count:10,attempts:0,success_rate:null,visibility:'private'},'Nom & test');
 assert.match(html,/—/);assert.match(html,/0 parties/);assert.match(html,/Collection privée/);assert.doesNotMatch(html,/profil public/);assert.doesNotMatch(html,/NaN/);
 const zero=render({attempts:2,success_rate:0,visibility:'friends'},'Test');assert.match(zero,/0 %/);assert.match(zero,/réservée à vos amis/);
 assert.equal(render(null,'Test'),'');
});
test('Collect summary reports active cards, archived copies, albums, badges and the encoded owner profile',async()=>{
 const {renderCollectProfileSummary:render}=await renderer;
 const html=render({unique_cards:5,total_copies:8,active_unique_cards:3,active_card_count:10,progress:30,attempts:4,success_rate:75,albums:[{complete:true},{complete:false}],badges:[{earned:true}],visibility:'public'},'Nom & test');
 assert.match(html,/3 \/ 10 cartes actives · 30 %/);assert.match(html,/2 cartes archivées conservées/);assert.match(html,/1 album complet · 1 badge obtenu/);assert.match(html,/profile=Nom%20%26%20test/);assert.match(html,/75 %/);
});
test('private profile repository exposes only the logged-in visibility and respects the public launch gate',async()=>{
 let calls=0;const queries=[];
 const db={pool:{query:async(sql,args)=>{queries.push([sql,args]);return {rows:sql.includes('collect_visibility')?[{collect_visibility:'private'}]:[{collect_public:true,explorer_public:false}]};}},getCollectProfileStats:async id=>{calls++;assert.equal(id,42);return {unique_cards:3};}};
 assert.deepEqual(await createProfileRepository(db).getModes(42),{collect:{unique_cards:3,visibility:'private'}});
 assert.ok(queries.some(([sql,args])=>sql.includes('collect_visibility')&&args[0]===42));
 db.pool.query=async()=>({rows:[{collect_public:false,explorer_public:false}]});
 assert.deepEqual(await createProfileRepository(db).getModes(42),{});assert.equal(calls,1);
});
test('public rules return the effective quota and keep unreleased modes disabled without exposing inventory',async()=>{
 const db={pool:{query:async()=>({rows:[{collect_public:true,explorer_public:false}]})},getCollectQuota:async id=>{assert.equal(id,null);return {copies:0,limit:3,windowMinutes:17,nextAvailableAt:'private'};}};
 assert.deepEqual(await publicRules(db),{collect:true,explorer:false,collectRules:{quota:{copies:3,windowMinutes:17}}});
 db.pool.query=async()=>({rows:[{collect_public:false,explorer_public:false}]});db.getCollectQuota=()=>assert.fail('No quota read for a private mode');assert.deepEqual(await publicRules(db),{collect:false,explorer:false});
});
