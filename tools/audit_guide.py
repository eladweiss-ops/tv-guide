import json,re,collections,datetime
g=json.load(open('guide.json',encoding='utf-8')); names={c['id']:c['name'] for c in g['channels']}
P=collections.defaultdict(list)
for p in g['programs']: P[p['ch']].append(p)
today=datetime.date(2026,10,30)
days=[(today+datetime.timedelta(d)).isoformat() for d in range(7)]
issues=collections.defaultdict(list)
for ch,ps in P.items():
    ps.sort(key=lambda p:p['start'])
    cnt=collections.Counter(p['start'][:10] for p in ps)
    # 1 dates: weekday sanity — first prog per day exists; gaps in the middle of the week
    have=[d for d in days if cnt[d]>0]
    if have:
        miss=[d for d in days if have[0]<=d<=have[-1] and cnt[d]<3]
        if miss: issues['missing day inside range'].append((names[ch],miss))
    # 2 duplicate starts
    st=collections.Counter(p['start'] for p in ps)
    d=[k for k,v in st.items() if v>1]
    if d: issues['duplicate start time'].append((names[ch],len(d),d[:2]))
    # 3 near-duplicate (same title within 5 min) – from gap filling
    for a,b in zip(ps,ps[1:]):
        ta=datetime.datetime.fromisoformat(a['start']); tb=datetime.datetime.fromisoformat(b['start'])
        if (tb-ta).total_seconds()<300 and a['title']==b['title']:
            issues['same show twice within 5 min'].append((names[ch],a['start'],a['title'])); break
    # 4 desc == title, html entities
    for p in ps:
        if re.search(r'&(#\d+|[a-z]+);',p['title']+p.get('desc','')): issues['html entity'].append((names[ch],p['title'][:40])); break
    for p in ps:
        if p.get('desc') and re.sub(r'\W','',p['desc'])==re.sub(r'\W','',p['title']): issues['desc equals title'].append((names[ch],p['title'][:40])); break
    # 5 very long gaps (> 6h) in day time between programs
    for a,b in zip(ps,ps[1:]):
        ta=datetime.datetime.fromisoformat(a['start']); tb=datetime.datetime.fromisoformat(b['start'])
        if (tb-ta).total_seconds()>8*3600 and a['start'][:10] in days:
            issues['gap > 8h'].append((names[ch],a['start'],a['title'][:30])); break
for k,v in issues.items():
    print(f"== {k}: {len(v)} channels")
    for x in v[:8]: print('   ',x)
