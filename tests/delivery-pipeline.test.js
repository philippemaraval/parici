const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { selectPreviousLiveDeploy, findCommitDeploy, deployWithRollback, assertHealthy } = require("../scripts/render_delivery");

test("le rollback cible le dernier déploiement live précédent", () => {
  const selected = selectPreviousLiveDeploy(
    [
      { deploy: { id: "new", status: "build_in_progress" } },
      { deploy: { id: "previous", status: "live" } },
      { deploy: { id: "older", status: "live" } },
    ],
    "new",
  );
  assert.equal(selected.id, "previous");
});

test("la livraison déploie directement la production après la CI", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "delivery.yml"),
    "utf8",
  );
  assert.match(workflow, /environment:\s*production/);
  assert.doesNotMatch(workflow, /environment:\s*staging/);
  assert.doesNotMatch(workflow, /needs:\s*staging/);
  assert.doesNotMatch(workflow, /CAMINO_DELIVERY_ENABLED/);
  assert.match(workflow,/PRODUCTION_FRONTEND_URL/);
  assert.match(workflow, /head_branch == 'main'/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /RENDER_PRODUCTION_SERVICE_ID/);
  assert.match(workflow, /PRODUCTION_HEALTHCHECK_URL/);
  assert.match(workflow, /scripts\/render_delivery\.js/);
});


test("une réponse Render mise en file attend le bon commit sans redéclencher le déploiement",async()=>{
  const previousFetch=global.fetch;let posts=0,lists=0;
  global.fetch=async(url,options={})=>{
    url=String(url);
    if(url.includes('/api/editor/'))return new Response(null,{status:401});
    if(url.endsWith('/api/health'))return Response.json({ok:true,database:'ready',backendCommit:'expected-sha'});
    if(url.endsWith('/admin/build-info.json'))return Response.json({commit:'expected-sha'});
    if(options.method==='POST'){posts++;return new Response(null,{status:202});}
    if(url.endsWith('/deploys?limit=20')){lists++;return Response.json(lists===1?[{deploy:{id:'old',status:'live',commit:{id:'old-sha'}}}]:[{deploy:{id:'queued',status:'build_in_progress',commit:{id:'expected-sha'}}}]);}
    if(url.includes('/deploys/queued'))return Response.json({id:'queued',status:'live',commit:{id:'expected-sha'}});
    return Response.json({ok:true,database:'ready'});
  };
  try{const result=await deployWithRollback({apiKey:'explicit-test-fixture',commitId:'expected-sha',serviceId:'test-service',healthcheckUrl:'https://example.test/ready'});assert.equal(result.id,'queued');assert.equal(posts,1);assert.equal(lists,2);}
  finally{global.fetch=previousFetch;}
});
test("la file de déploiement ignore les autres commits et les déploiements échoués",()=>{
 assert.equal(findCommitDeploy([{deploy:{id:'wrong',status:'live',commit:{id:'other'}}},{deploy:{id:'failed',status:'build_failed',commit:{id:'expected'}}}], 'expected'),undefined);
});


test("la sonde serveur ne simule pas une origine navigateur refusée par CORS", async (t) => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  let headers;
  global.fetch = async (_url, options) => {
    headers = new Headers(options.headers);
    return Response.json({ ok: true, database: "ready" });
  };
  await assertHealthy("https://api.example.test/api/ready");
  assert.equal(headers.has("origin"), false);
  assert.equal(headers.get("accept"), "application/json");
});
