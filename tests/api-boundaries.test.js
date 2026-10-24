const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../src/types/api-boundaries.js')).toString('base64'));
test('verified sessions require UUID sessions and canonical target names',async()=>{
 const {parseVerifiedSession}=await load(),valid={sessionId:'00000000-0000-4000-8000-000000000001',targets:['Rue Oberkampf']};
 assert.deepEqual(parseVerifiedSession(valid),valid);for(const value of [{targets:valid.targets},{...valid,sessionId:'local'},{...valid,targets:[42]},{...valid,targets:[]}])assert.throws(()=>parseVerifiedSession(value));
});
test('Collect rejects malformed games while preserving real API fields',async()=>{
 const {parseCollectGame}=await load();const game={gameId:'00000000-0000-4000-8000-000000000001',maxAttempts:2,guesses:[],card:{family:'street',name:'Rue Oberkampf',imageReference:'/photo.webp'},quota:{copies:0,limit:4}};assert.deepEqual(parseCollectGame(game),game);
 for(const value of [{...game,gameId:'local'},{...game,card:{...game.card,family:'invented'}},{...game,maxAttempts:0},{...game,quota:{copies:'0',limit:4}}])assert.throws(()=>parseCollectGame(value));
});
test('Explorer accepts the nested server solution and rejects corrupt progress',async()=>{
 const {parseExplorerProgress}=await load();const payload={progress:[{riddle_id:1,points_earned:85,solution:{street_name_clean:'Rue Oberkampf'}}],profile:{completed:false,solved_count:1}};assert.deepEqual(parseExplorerProgress(payload),payload);assert.throws(()=>parseExplorerProgress({...payload,profile:{completed:'false',solved_count:1}}));assert.throws(()=>parseExplorerProgress({...payload,progress:[{riddle_id:'wrong',points_earned:85}]}));
});
