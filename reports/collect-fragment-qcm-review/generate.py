"""Render authored Parici QCM. No facts, questions or distractors are invented here."""
import argparse
import json
import random
import uuid
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


def build():
    metadata = json.loads((ROOT / 'cards.json').read_text())
    authored = defaultdict(list)
    for line_number, line in enumerate((ROOT / 'authored.tsv').read_text().splitlines(), 1):
        if not line.strip():
            continue
        fields = line.split('|')
        if len(fields) != 7:
            raise ValueError(f'Line {line_number}: seven fields required')
        reference, theme, prompt, correct, *wrong = fields
        authored[int(reference)].append((theme, prompt, [correct, *wrong]))
    # Balanced positions, shuffled once with a fixed seed for reproducibility.
    positions = [i % 4 for i in range(299)]
    rng = random.Random('parici-qcm-20261015-v1')
    rng.shuffle(positions)
    cards = []
    cursor = 0
    for meta in metadata:
        card = {k: v for k, v in meta.items() if k not in ('description', 'sources')}
        questions = []
        for position, (theme, prompt, clauses) in enumerate(authored[meta['reference']], 1):
            correct_index = positions[cursor]
            cursor += 1
            correct = meta['pronoun'] + ' ' + clauses[0] + '.'
            distractors = [meta['pronoun'] + ' ' + value + '.' for value in clauses[1:]]
            rng.shuffle(distractors)
            distractors.insert(correct_index, correct)
            name = meta['name']
            explanation = name[0].upper() + name[1:] + ' ' + clauses[0] + '. ' + meta['description']
            questions.append({
                'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'parici:fragment-review:v1:' + meta['family'] + ':' + meta['source_entity_id'] + ':' + str(position))),
                'theme': theme,
                'topic': prompt,
                'question': f'Concernant {name}, {prompt[0].lower() + prompt[1:]}',
                'options': distractors,
                'correct_answer_index': correct_index,
                'explanation': explanation,
                'sources': meta['sources'],
                'status': 'draft_for_review',
            })
        card['questions'] = questions
        cards.append(card)
    return {'revision': '20261015-1', 'status': 'draft_for_review', 'cards': cards}


def validate(bank):
    cards = bank['cards']
    assert len(cards) == 102
    assert Counter(c['fragments'] for c in cards) == {2: 43, 3: 23, 4: 36}
    assert {c['reference'] for c in cards} == set(range(1, 103))
    assert len({(c['family'], c['source_entity_id']) for c in cards}) == 102
    ids = set()
    positions = Counter()
    catalog = json.loads((REPO / 'data/collect_paris_catalog.json').read_text())
    expected = {(r['family'], r['source_entity_id']): r for r in catalog['records'] if r['base_rarity'] == 5 or r['fragments_required']}
    assert set(expected) == {(c['family'], c['source_entity_id']) for c in cards}
    prepared = json.loads((REPO / 'data/collect_paris_fragments.json').read_text())
    for c in cards:
        assert c['name'].startswith(('le ', 'la ', 'l’'))
        assert len(c['questions']) == c['fragments'] == prepared[c['family'] + ':' + c['source_entity_id']]
        assert len({q['question'] for q in c['questions']}) == c['fragments']
        for q in c['questions']:
            assert q['id'] not in ids
            ids.add(q['id'])
            assert str(uuid.UUID(q['id'])) == q['id']
            assert len(q['options']) == len(set(x.casefold() for x in q['options'])) == 4
            assert all(x.startswith(c['pronoun'] + ' ') for x in q['options'])
            assert type(q['correct_answer_index']) is int and q['correct_answer_index'] in range(4)
            assert c['name'] in q['question']
            assert q['explanation'] and q['theme'] and q['topic']
            assert q['status'] == 'draft_for_review'
            assert q['sources'] and all(u.startswith('https://') for u in q['sources'])
            positions[q['correct_answer_index']] += 1
    assert len(ids) == 299
    assert max(positions.values()) - min(positions.values()) <= 1
    return positions


def render(bank, fragments=None):
    cards = [c for c in bank['cards'] if fragments is None or c['fragments'] == fragments]
    lines = ['# QCM Collect Parici — banque pour relecture', '',
             f"{len(cards)} cartes · {sum(len(c['questions']) for c in cards)} questions · Version {bank['revision']}", '',
             'Les numéros correspondent à la liste des 102 cartes légendaires. '
             'Chaque carte possède autant de questions que de fragments. '
             'Banque préparée : aucune activation ni publication.', '']
    for c in cards:
        lines += [f"## {c['reference']}. {c['catalog_name']} — {c['fragments']} fragments", '',
                  f"Famille : {c['family']} · Identifiant : `{c['source_entity_id']}`", '']
        for number, q in enumerate(c['questions'], 1):
            lines += [f"### Question {number} — {q['theme']}", '', q['question'], '']
            lines += [f"- **{'ABCD'[i]}.** {option}" for i, option in enumerate(q['options'])]
            lines += ['', f"**Bonne réponse : {'ABCD'[q['correct_answer_index']]}**", '', q['explanation'], '',
                      'Sources : ' + ' · '.join(f'[Source {i}]({u})' for i, u in enumerate(q['sources'], 1)), '']
    return '\n'.join(lines).rstrip() + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    bank = build()
    positions = validate(bank)
    outputs = {'questions.json': json.dumps(bank, ensure_ascii=False, indent=2) + '\n', 'questions.md': render(bank)}
    outputs.update({f'questions-{n}-fragments.md': render(bank, n) for n in (2, 3, 4)})
    for filename, content in outputs.items():
        path = ROOT / filename
        if args.check:
            assert path.read_text() == content, f'Outdated export: {filename}'
        else:
            path.write_text(content)
    print('102 cards, 299 questions, 1196 options. Positions:', dict(sorted(positions.items())))


if __name__ == '__main__':
    main()
