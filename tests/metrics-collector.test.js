const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const express=require('express');
const {createObservability}=require('../backend/observability');
const {metricsToken}=require('../scripts/render_metrics_token');
function runMonitor(base,overrides={}) {
 return new Promise(resolve=>{const child=spawn(process.execPath,[path.join(__dirname,'../scripts/check_production_health.js')],{env:{...process.env,HEALTHCHECK_URL:base+'/api/health',PRODUCTION_FRONTEND_URL:'',METRICS_URL:'',REQUIRE_METRICS:'true',METRICS_TOKEN:'isolated-metrics-token',MAX_API_ERRORS:'0',HEALTH_MAX_ATTEMPTS:'1',...overrides},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('close',code=>resolve({code,output}));});
}
test('protected metrics reject anonymous access and a controlled incident raises the monitor alert outcome',{timeout:30000},async t=>{
 const app=express(),observability=createObservability({metricsToken:'isolated-metrics-token',requireMetricsToken:true});
 app.use(observability.requestMiddleware);app.get('/api/metrics',observability.metricsHandler);
 app.get('/api/health',(_req,res)=>res.json({ok:true,database:'ready'}));
 app.get('/api/daily/health',(_req,res)=>res.json({ok:true,targetReady:true,streetIndexReady:true,imageReady:true}));
 app.get('/api/incident',(_req,res)=>res.status(503).json({error:'isolated incident'}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/metrics')).status,401);
 assert.equal((await fetch(base+'/api/metrics',{headers:{Authorization:'Bearer wrong'}})).status,401);
 let checked=await runMonitor(base);assert.equal(checked.code,0,checked.output);
 await fetch(base+'/api/incident');
 const exported=await fetch(base+'/api/metrics',{headers:{Authorization:'Bearer isolated-metrics-token'}});
 assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/text\/plain/);assert.equal(exported.headers.get('cache-control'),'no-store');
 const body=await exported.text();assert.match(body,/camino_api_errors_total\{operation="api"\} 1/);assert.match(body,/camino_http_request_duration_ms_bucket/);assert.doesNotMatch(body,/isolated-metrics-token|incident/);
 checked=await runMonitor(base);assert.equal(checked.code,1);assert.match(checked.output,/camino_api_errors_total=1 exceeds 0/);assert.match(checked.output,/"ok":false/);
 checked=await runMonitor(base,{MAX_API_ERRORS:'1'});assert.equal(checked.code,0,checked.output);
 checked=await runMonitor(base,{METRICS_TOKEN:''});assert.equal(checked.code,1);assert.match(checked.output,/METRICS_TOKEN is required/);
 const serverSource=fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8');assert.match(serverSource,/app.get\('\/api\/metrics', observability.metricsHandler\)/);assert.match(serverSource,/requireMetricsToken: true/);
});
test('missing metrics configuration fails closed',()=>{
 const observability=createObservability({requireMetricsToken:true});let status=0;
 observability.metricsHandler({headers:{}},{status(value){status=value;return this;},send(message){assert.match(message,/not configured/);}});assert.equal(status,503);
});
test('Render metrics provisioning preserves existing tokens and writes only the missing variable',async()=>{
 let writes=0;
 assert.equal(await metricsToken({apiKey:'test',serviceId:'svc',create:true,transport:async()=>Response.json({key:'METRICS_TOKEN',value:'existing-private-value'})}),'existing-private-value');
 const value=await metricsToken({apiKey:'test',serviceId:'svc',create:true,transport:async(url,options)=>{assert.equal(url,'https://api.render.com/v1/services/svc/env-vars/METRICS_TOKEN');if(options.method==='PUT'){writes++;assert.equal(Object.keys(JSON.parse(options.body)).join(','),'value');return Response.json({});}return new Response('',{status:404});}});
 assert.match(value,/^[a-f0-9]{64}$/);assert.equal(writes,1);
 await assert.rejects(metricsToken({apiKey:'test',serviceId:'svc',create:true,transport:async()=>new Response('',{status:403})}),/HTTP 403/);
});
