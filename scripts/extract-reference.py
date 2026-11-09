"""Extract the ministry-supplied reference PDF with column-aware chord geometry.

Requires pdfplumber. Source text is retained alongside editable ChordPro. Chord
locations are derived from glyph x positions; the supplied sheet remains the
authority where the original proportional typography is ambiguous.
"""
from pathlib import Path
import json
import re
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\jcocl\Downloads\Exalt-Tarlac-07-November-2026-Lineup (1).pdf")
CHORD = re.compile(r"[A-G](?:#|b)?(?:maj|min|m|sus|add|dim|aug)?\d*(?:sus\d*|add\d*)?(?:/[A-G](?:#|b)?)?")
SECTION = re.compile(r"^(?:Intro|Verse\s*\d*|Pre[- ]?Chorus|Chorus\s*\d*|Bridge\s*\d*|Interlude\s*\d*|Turnaround|Ending|Outro|Instrumental|Repeat.*)$", re.I)


def get_lines(page, left, right):
    chars = [c for c in page.chars if left <= c['x0'] < right and c['text'] != '\u0000']
    groups = []
    for c in sorted(chars, key=lambda c: (round(c['top'], 1), c['x0'])):
        found = next((g for g in reversed(groups[-3:]) if abs(g['top'] - c['top']) < 2), None)
        if found is None:
            found = {'top': c['top'], 'chars': []}
            groups.append(found)
        found['chars'].append(c)
    out = []
    for group in sorted(groups, key=lambda g: g['top']):
        text = ''
        positions = []
        previous = None
        for c in sorted(group['chars'], key=lambda c: c['x0']):
            if previous and c['x0'] - previous['x1'] > 1.7 and not text.endswith(' ') and c['text'] != ' ':
                text += ' '
                positions.append(previous['x1'])
            for character in c['text']:
                text += character
                positions.append(c['x0'])
            previous = c
        text = text.rstrip()
        if text.strip():
            trim = len(text) - len(text.lstrip())
            out.append({'text': text.strip(), 'positions': positions[trim:len(text)], 'top': group['top']})
    return out


def chord_tokens(line):
    tokens = list(CHORD.finditer(line['text']))
    remainder = CHORD.sub('', line['text'])
    if not tokens or re.sub(r'[\s\-–—|,]+', '', remainder):
        return []
    return [(match.group(), line['positions'][match.start()]) for match in tokens]


def section(line):
    return bool(SECTION.fullmatch(line['text'].strip('[]: ')))


def combine(chordline, lyricline):
    inserts = {}
    for chord, xpos in chord_tokens(chordline):
        if not lyricline['positions']:
            index = 0
        elif xpos > lyricline['positions'][-1] + 5:
            index = len(lyricline['text'])
        else:
            index = min(range(len(lyricline['positions'])), key=lambda i: abs(lyricline['positions'][i] - xpos))
        inserts.setdefault(index, []).append('[' + chord + ']')
    result = ''
    for i in range(len(lyricline['text']) + 1):
        result += ''.join(inserts.get(i, []))
        if i < len(lyricline['text']):
            result += lyricline['text'][i]
    return result


def to_chordpro(lines):
    output = []
    i = 0
    previous_y = None
    while i < len(lines):
        line = lines[i]
        text = line['text']
        if previous_y is not None and line['top'] - previous_y > 23:
            output.append('')
        if section(line):
            if output and output[-1] != '': output.append('')
            label = text.strip('[]: ')
            directive = 'comment' if label.lower().startswith('repeat') else 'section'
            output.append('{' + directive + ':' + label + '}')
        elif chord_tokens(line):
            if i + 1 < len(lines) and not chord_tokens(lines[i + 1]) and not section(lines[i + 1]) and 0 < lines[i+1]['top'] - line['top'] < 30:
                output.append(combine(line, lines[i+1]))
                i += 1
                line = lines[i]
            else:
                output.append(' '.join('[' + chord + ']' for chord, _ in chord_tokens(line)))
        else:
            output.append(text)
        previous_y = line['top']
        i += 1
    return '\n'.join(output).strip()


def raw_layout(columns):
    pages = []
    for page, col, lines in columns:
        result = [f'--- Page {page}, {col} column ---']
        base = min((min(l['positions']) for l in lines if l['positions']), default=0)
        for line in lines:
            pieces = []
            for char, xpos in zip(line['text'], line['positions']):
                index = round((xpos-base)/6)
                while len(pieces) < index: pieces.append(' ')
                pieces.append(char)
            result.append(''.join(pieces).rstrip())
        pages.append('\n'.join(result))
    return '\n\n'.join(pages)


def main():
    with pdfplumber.open(SOURCE) as document:
        all_columns = []
        for number, page in enumerate(document.pages, 1):
            columns = [(number, 'left', get_lines(page, 0, 307))]
            if number < 5:
                columns.append((number, 'right', get_lines(page, 307, 612)))
            all_columns.append(columns)
        metadata = [
            dict(id='praise-yahweh', title='Praise Yahweh', artist='Exalt Worship', key='Bb', bpm=None, language='English', aliases=[], tags=['Praise', 'Exalt Worship']),
            dict(id='magpakailanman', title='Magpakailanman', artist='Passion Generation', key='D', bpm=138, language='Filipino', aliases=[], tags=['Praise', 'Filipino']),
            dict(id='all-of-creation', title='All of Creation (Even So Come)', artist='Chris Tomlin', key='A', bpm=None, language='English', aliases=['Even So Come', 'All of Creation'], tags=['Worship', 'Second coming']),
            dict(id='christ-be-magnified', title='Christ Be Magnified', artist='Cody Carnes', key='G', originalKey='A', bpm=72, timeSignature='4/4', language='English', aliases=[], tags=['Worship', 'Surrender']),
        ]
        songs = []
        for index, info in enumerate(metadata):
            columns = all_columns[index]
            raw = raw_layout(columns)
            header_count = [3,4,3,3][index]
            processed = [(p, c, lines[header_count:] if c == 'left' else lines) for p, c, lines in columns]
            if index == 3:
                raw += '\n\n' + raw_layout(all_columns[4])
                processed += all_columns[4]
            content = '\n\n'.join(to_chordpro(lines) for _,_,lines in processed)
            songs.append(dict(**info, content=content, originalSource=raw,
                source='Supplied CCF Tarlac lineup • 7 November 2026',
                notes='Imported from the supplied ministry PDF. Chord positions follow the source layout; review against the original sheet before use.',
                needsReview=True, sourcePages=[index+1] if index < 3 else [4,5]))
        output = dict(songs=songs, lineup=dict(id='reference-lineup-2026-11-07', title='Exalt Tarlac · Reference lineup', date='2026-11-07', status='draft', notes='Imported from the supplied 7 November 2026 lineup. Review song arrangements before finalizing.', entries=[dict(songId=s['id'], key=s['key'], notes='') for s in songs]))
        path = ROOT / 'src/data/reference-songs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        (ROOT/'tmp/pdf/reference-extracted.txt').write_text('\n\n'.join(s['title']+'\n'+s['content'] for s in songs), encoding='utf-8')
        print(f'Wrote {len(songs)} songs to src/data/reference-songs.json')
        print([(s['title'],len(s['content'].splitlines())) for s in songs])


if __name__ == '__main__':
    main()
