import json,re,collections,sys
g=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'guide.json'))
names={c['id']:c['name'] for c in g['channels']}
def kind(t):
    t=t or ''
    if re.search(r'כדורגל',t): return 'fb'
    if re.search(r'כדורסל|ווינר סל|יורוליג|יורוקאפ|\bNBA\b|WNBA',t,re.I): return 'bb'
    if re.search(r'\bNFL\b|פוטבול',t,re.I): return 'af'
    if re.search(r'\bNHL\b|הוקי',t,re.I): return 'ih'
    if re.search(r'טניס|\bATP\b|\bWTA\b',t,re.I): return 'tn'
    if re.search(r'פורמולה|\bF1\b|מוטו ?GP|נאסקר|GT ',t,re.I): return 'mt'
    if re.search(r'פרמייר ליג|לה ליגה|סרייה|בונדסליגה|ליגת האלופות|ל\. (צרפתית|ספרדית|איטלקית|אנגלית|גרמנית)|גביע הטוטו|ליגת ווינר(?! סל)|גביע הליגה',t): return 'fb'
    return ''
bad=collections.Counter(); ex=collections.defaultdict(list)
for p in g['programs']:
    d=p.get('desc','')
    if not d: continue
    kt,kd=kind(p['title']),kind(d)
    if kt and kd and kt!=kd:
        bad[names.get(p['ch'],p['ch'])]+=1; ex[names.get(p['ch'],p['ch'])].append((p['start'],p['title'],d[:50]))
print('sport-kind conflicts per channel:',dict(bad))
for k,v in ex.items():
    for x in v[:4]: print('  ',k,x)
# desc that is itself a known program title on same channel at a different time (shifted matching)

ABBR=[(r'(^|[\s\-–(])מ\.\s?','\\1מכבי '),(r'(^|[\s\-–(])ה\.\s?','\\1הפועל '),(r'(^|[\s\-–(])ב\.\s?','\\1בית"ר '),(r'(^|[\s\-–(])ע\.\s?','\\1עירוני '),(r'(^|[\s\-–(])ל\.\s?','\\1ליגה '),(r'(^|[\s\-–(])ת"?א(?=$|[\s\-–),.])','\\1תל אביב'),(r'(^|[\s\-–(])ב"?ש(?=$|[\s\-–),.])','\\1באר שבע'),(r'(^|[\s\-–(])רג(?=$|[\s\-–),.])','\\1רמת גן'),(r'(^|[\s\-–(])פ"?ת(?=$|[\s\-–),.])','\\1פתח תקווה')]
STOP=set('ישיר של עם את על נגד מחזור עונת ליגת ליגה ליגה גביע ה - תוכנית פרק'.split())
def toks(t):
    t=' '+re.sub(r'[״"]','"',t or '')+' '
    for a,b in ABBR: t=re.sub(a,b,t)
    w=re.findall(r'[\w"]+',t.lower())
    out=set()
    for x in w:
        x=x.strip('"')
        if len(x)<3 or x in STOP or x.isdigit(): continue
        out.add(x[:4])  # stem-ish prefix
    return out
SPORT=re.compile(r'ספורט|sport|one|5\s*(live|gold|stars|max)|5gold|5max|eurosport',re.I)
stats=collections.Counter(); flag=collections.defaultdict(list)
for p in g['programs']:
    n=names.get(p['ch'],'')
    if not SPORT.search(n) or not p.get('desc'): continue
    stats[n,'d']+=1
    if not (toks(p['title']) & toks(p['desc'])):
        stats[n,'x']+=1; flag[n].append((p['start'],p['title'],p['desc'][:45]))
print('\nsport channels: desc with no shared word with title (suspect / total):')
for n in sorted({k[0] for k in stats}):
    print(f"  {n}: {stats[n,'x']}/{stats[n,'d']}")
    for x in flag[n][:3]: print('      ',x)
