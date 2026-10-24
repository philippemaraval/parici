const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createTestDatabase}=require('./test-database');
test('profile statistics, mode-gated rules and mode reports remain private and rate limited on PostgreSQL', {skip:!process.env.TEST_DATABASE_URL,timeout:180000}, async t=>{
 const isolated=await createTestDatabase(process.env.TEST_DATABASE_URL,'parici_profile_contact');
 process.env.DATABASE_URL=isolated.url;process.env.NODE_ENV='production';process.env.SECRET_KEY='parici-profile-contact-local-validation-secret';
 const db=require('../../backend/database'),{app,initializeDatabase}=require('../../backend/server');
 const server=http.createServer(app);
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await db.pool.end();await isolated.cleanup();});
 await initializeDatabase({startBackgroundServices:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,user,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const player=(await request('/api/register',null,{username:'profile_contact_player',password:'local-test-password-long',recoveryEmail:'profile-contact@example.test'})).body;
 assert.ok(player.id);
 await db.pool.query("UPDATE users SET collect_visibility='private',collect_profile_public=FALSE WHERE id=$1",[player.id]);
 const cards=(await db.pool.query("SELECT id FROM cards WHERE status='active' AND catalog_present ORDER BY id LIMIT 2")).rows;
 for(const id of [cards[0].id,cards[0].id,cards[1].id])await db.pool.query("INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",[player.id,id]);
 await db.pool.query("UPDATE cards SET status='archived' WHERE id=$1",[cards[1].id]);
 const profile=(await request('/api/profile',player)).body;
 const stats=await db.getCollectProfileStats(player.id);
 for(const key of ['unique_cards','total_copies','active_unique_cards','active_card_count','success_rate','attempts','progress'])assert.equal(profile.collect[key],stats[key],key);
 assert.equal(profile.collect.visibility,'private');assert.equal(stats.unique_cards,2);assert.equal(stats.active_unique_cards,1);assert.equal(stats.total_copies,3);assert.equal(stats.success_rate,null);
 assert.equal((await request('/api/collect/profiles/profile_contact_player')).status,404);
 await db.pool.query("UPDATE collect_config SET value_json=$1::jsonb WHERE key='reward_quota'",[JSON.stringify({copies:3,window_minutes:17})]);
 const modes=await request('/api/site/modes');assert.equal(modes.status,200);assert.equal(modes.body.collect,true);assert.equal(modes.body.explorer,false);assert.deepEqual(modes.body.collectRules.quota,{copies:3,windowMinutes:17});
 await db.pool.query("UPDATE app_settings SET value_text='infinity' WHERE key='collect_launch_at'");
 assert.deepEqual((await request('/api/site/modes')).body,{collect:false,explorer:false});assert.equal((await request('/api/profile',player)).body.collect,undefined);
 await db.pool.query("INSERT INTO app_settings(key,value_text) VALUES('explorer_public','true') ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text");assert.equal((await request('/api/site/modes')).body.explorer,true);
 const reports=[];
 for(const domain of ['collect','explorer']){
  const body={domain,entity_key:'p11-'+domain,category:'bug',detail:'Signalement général de validation '+domain};
  const sent=await request('/api/site/reports',player,body);assert.equal(sent.status,201,JSON.stringify(sent.body));reports.push({id:sent.body.id,domain});
  if(domain==='collect'){const duplicate=await request('/api/site/reports',player,body);assert.equal(duplicate.status,200);assert.equal(duplicate.body.id,sent.body.id);}
 }
 for(const body of [
  {domain:'unknown',entity_key:'',category:'bug',detail:'Signalement suffisamment long'},
  {domain:'collect',entity_key:'',category:'unknown',detail:'Signalement suffisamment long'},
  {domain:'explorer',entity_key:'',category:'bug',detail:'court'},
 ])assert.equal((await request('/api/site/reports',player,body)).status,400);
 const admin=(await request('/api/register',null,{username:'profile_contact_admin',password:'local-test-password-long',recoveryEmail:'profile-contact-admin@example.test'})).body;
 await db.setUserRole('profile_contact_admin','admin');
 const adminLogin=(await request('/api/login',null,{username:'profile_contact_admin',password:'local-test-password-long'})).body;assert.ok(admin.id&&adminLogin.token);
 const inbox=await request('/api/admin/site-reports',adminLogin);assert.equal(inbox.status,200);
 for(const report of reports)assert.ok(inbox.body.reports.some(r=>String(r.id)===String(report.id)&&r.domain===report.domain));
 assert.equal((await request('/api/admin/site-reports',player)).status,403);
 let limited=false;
 for(let i=0;i<12;i++){
  const sent=await request('/api/site/reports',player,{domain:'technical',entity_key:'spam-'+i,category:'bug',detail:'Validation de la limite de signalements'});
  if(sent.status===429)limited=true;else assert.equal(sent.status,201);
 }
 assert.equal(limited,true);
});
