const test = require('node:test');
const assert = require('node:assert/strict');
const articles = require('../data/collect_wikipedia.json');
const catalog = require('../data/collect_paris_catalog.json');
const { wikipediaLink } = require('../backend/domains/collect/wikipedia-link');

test('checked Wikipedia articles match existing Paris places and canonical article URLs', () => {
  const cards = new Map(catalog.records.map(c => [c.family+':'+c.source_entity_id,c]));
  const counts = {};
  const pageIds = new Set();
  for(const [key, entry] of Object.entries(articles)) {
    assert.ok(cards.has(key), `Unknown card ${key}`);
    const family = cards.get(key).family;
    counts[family]=(counts[family]||0)+1;
    assert.equal(entry.subject,'place');
    assert.match(entry.verifiedAt,/^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.wikidataId,/^Q[1-9]\d*$/);
    assert.equal(pageIds.has(entry.pageId),false,`Repeated article ${key}`);
    pageIds.add(entry.pageId);
    assert.equal(wikipediaLink(family,cards.get(key).source_entity_id), new URL(entry.url).href);
    assert.equal(decodeURIComponent(new URL(entry.url).pathname.slice(6)).replace(/_/g,' '),entry.title);
  }
  assert.deepEqual(counts,{district:80,monument:107});
});

test('Cluny links to the building and Conciergerie to the Paris monument', () => {
  assert.equal(wikipediaLink('monument','Hôtel de Cluny'),'https://fr.wikipedia.org/wiki/H%C3%B4tel_de_Cluny');
  assert.equal(wikipediaLink('monument','Conciergerie'),'https://fr.wikipedia.org/wiki/Conciergerie_de_Paris');
  assert.equal(wikipediaLink('district','Quartier de la Sorbonne'),'https://fr.wikipedia.org/wiki/Quartier_de_la_Sorbonne');
  assert.equal(wikipediaLink('street','Rue Victor Hugo'),null);
  assert.equal(wikipediaLink('bus','1'),null);
  assert.equal(wikipediaLink('monument','Unknown'),null);
});

test('unchecked, ambiguous or non-article URLs cannot become a Wikipedia button', t => {
  const key='monument:__invalid_wikipedia_probe';
  t.after(()=>delete articles[key]);
  const valid={subject:'place',pageId:1,title:'Lieu test',url:'https://fr.wikipedia.org/wiki/Lieu_test'};
  for(const entry of [
    {...valid,subject:'person'}, {...valid,subject:undefined}, {...valid,pageId:0},
    {...valid,url:'https://fr.wikipedia.org/w/index.php?search=Lieu_test'},
    {...valid,url:'https://fr.wikipedia.org/wiki/Spécial:Recherche?search=Lieu_test'},
    {...valid,title:'Spécial:Recherche',url:'https://fr.wikipedia.org/wiki/Sp%C3%A9cial:Recherche'},
    {...valid,url:'https://fr.wikipedia.org/wiki/Autre_lieu'},
    {...valid,url:'https://fr.wikipedia.org/wiki/Lieu_test?search=foo'},
    {...valid,url:'https://fr.wikipedia.org:8443/wiki/Lieu_test'},
    {...valid,url:'https://example.org/wiki/Lieu_test'},
    {...valid,url:'https://account@fr.wikipedia.org/wiki/Lieu_test'},
    {...valid,url:'http://fr.wikipedia.org/wiki/Lieu_test'},
  ]) {
    articles[key]=entry;
    assert.equal(wikipediaLink('monument','__invalid_wikipedia_probe'),null,JSON.stringify(entry));
  }
});
