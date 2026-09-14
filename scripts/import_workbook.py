"""Offline, deterministic workbook -> validated aggregate snapshot. Never runs in Workers."""
from __future__ import annotations
import argparse, collections, datetime as dt, hashlib, json, math, statistics
from pathlib import Path
import openpyxl
from scipy.stats import t as student_t

VERSION='1.0.0'
STATUS=['Free win','Move + reprice','Costs to retain','Hold','No live equivalent','Excluded - C&I','Excluded - friends & family','Excluded - no margin data']
def number(v):
    return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def date(v):
    if isinstance(v,dt.datetime): return v.date()
    if isinstance(v,dt.date): return v
    raise ValueError(f'Expected Excel date, got {type(v).__name__}')
def iso(v): return v.isoformat()
def mean(xs): return statistics.mean(xs) if xs else None
def total(rows,k): return sum(r[k] for r in rows if number(r.get(k)))
def records(w,sheet,columns):
    it=w[sheet].values; heads=next(it)
    if not set(columns).issubset(heads): raise ValueError(f'{sheet}: missing columns {set(columns)-set(heads)}')
    rows=[]
    for i,values in enumerate(it,2):
        if not any(v is not None for v in values): continue
        row=dict(zip(heads,values))
        for k in columns:
            if isinstance(row.get(k),str) and row[k].startswith(('#REF!','#DIV/0!','#VALUE!','#N/A','#NUM!','#NAME?')):
                raise ValueError(f'{sheet}! row {i}, {k}: formula error')
        if 'PlanCode' in row: row['PlanCode']=str(row['PlanCode'] or '').strip()
        rows.append(row)
    return rows

def build(path):
    w=openpyxl.load_workbook(path,read_only=True,data_only=True)
    plans=records(w,'Operating_Plans w Price and Cos',['PlanCode','PlanIsActive','Network','CustomerType'])
    demand=records(w,'plan_demand_counts',['PlanCode','Channel','IntervalDate','Suppressed','NMI_Count','Network','CustomerType'])
    daily=records(w,'winloss_daily',['EventDate','PlanCode','Wins','Losses'])
    eme=records(w,'Weekly EME Ranking Data (Histor',['WeekStarting','Grid','CustomerType','Ranking','RetailerCount','IsFlipped'])
    base=records(w,'base table',['PlanCode','Customers','AnnualPrice','Margin$','MarginPct','Status','MarginAtStake','ChurnCost'])
    detail=records(w,'winloss_detail',['Direction','BusinessName','n'])
    w.close()
    if any(not x for x in [plans,demand,daily,eme,base,detail]): raise ValueError('Required sheet is empty')
    if len({r['PlanCode'] for r in base})!=len(base): raise ValueError('Duplicate plan codes in base table')
    for row in daily:
        row['EventDate']=date(row['EventDate'])
        if any(not number(row[k]) or row[k]<0 for k in ['Wins','Losses']): raise ValueError('Invalid daily count')
    for row in demand: row['IntervalDate']=date(row['IntervalDate'])
    for row in eme: row['WeekStarting']=date(row['WeekStarting'])
    books={}; catalogue={}
    for row in plans:
        book='Front-Book' if row['PlanIsActive']==1 else 'Back-Book'
        if row['PlanCode'] in books and books[row['PlanCode']]!=book: raise ValueError('Conflicting active flags')
        books[row['PlanCode']]=book
        segment=(row['Network'],str(row['CustomerType']).upper())
        if row['PlanCode'] in catalogue and catalogue[row['PlanCode']]!=segment: raise ValueError('Conflicting catalogue metadata')
        catalogue[row['PlanCode']]=segment
    usable=[r for r in demand if r['Channel']=='E' and r['Suppressed']==0]
    if any(not number(r['NMI_Count']) or r['NMI_Count']<0 for r in usable): raise ValueError('Invalid customer count')
    latest=max(r['IntervalDate'] for r in demand if r['Channel']=='E')
    latest_eme=max(r['WeekStarting'] for r in eme)
    byplan=collections.defaultdict(list)
    for row in usable: byplan[row['PlanCode']].append(row)
    customers={}; meta={}; snapshot_dates={}
    for code,book in books.items():
        rs=byplan[code]
        day=latest if book=='Front-Book' or not rs else max(r['IntervalDate'] for r in rs)
        current=[r for r in rs if r['IntervalDate']==day]
        customers[code]=total(current,'NMI_Count');snapshot_dates[code]=day if current else None
        segments={(r['Network'],{'RESI':'RESIDENTIAL','BUSI':'BUSINESS'}.get(r['CustomerType'],r['CustomerType'])) for r in current}
        if len(segments)>1: raise ValueError(f'Ambiguous plan/network mapping: {code}')
        meta[code]=next(iter(segments),catalogue.get(code,(None,None)))
    trend=collections.defaultdict(lambda:{'wins':0,'losses':0})
    for row in daily:
        monday=row['EventDate']-dt.timedelta(days=row['EventDate'].weekday())
        trend[monday]['wins']+=row['Wins'];trend[monday]['losses']+=row['Losses']
    cutoff=max(r['EventDate'] for r in daily)-dt.timedelta(days=27)
    recent=collections.Counter()
    for row in daily:
        if row['EventDate']>=cutoff: recent[row['PlanCode']]+=row['Wins']
    own=[r for r in eme if r['IsFlipped']==1 and number(r['Ranking']) and number(r['RetailerCount'])]
    markets=collections.defaultdict(list)
    for row in own:
        if row['WeekStarting']==latest_eme: markets[(str(row['Grid']).upper(),str(row['CustomerType']).upper())].append(row)
    plan_rows=[]
    for code,book in books.items():
        net,ctype=meta[code]; market=markets.get((str(net).upper(),str(ctype).upper()),[])
        crowd=mean([r['RetailerCount'] for r in market]); rank=mean([r['Ranking'] for r in market])
        flag='No EME match' if crowd is None else 'True under-performance' if recent[code]<2 and crowd>=15 else 'Small market — review' if recent[code]<2 else 'Performing normally'
        if book=='Back-Book': flag='Legacy plan — not on sale'
        plan_rows.append(dict(code=code,book=book,network=net or 'Unknown',customerType=ctype or 'Unknown',customers=customers[code],asOf=iso(snapshot_dates[code]) if snapshot_dates[code] else None,recentSignups=recent[code],competitors=crowd,rank=rank,status=flag))
    valid_base=[r for r in base if all(number(r[k]) for k in ['Margin$','AnnualPrice','Customers']) and r['AnnualPrice']>0 and r['Customers']>=0]
    denominator=sum(r['AnnualPrice']*r['Customers'] for r in valid_base)
    margin=sum(r['Margin$']*r['Customers'] for r in valid_base)/denominator if denominator else None
    legacy=[r for r in base if r['Status'] in STATUS]
    statuses=[]
    for status in STATUS:
        rs=[r for r in legacy if r['Status']==status]
        if rs: statuses.append(dict(status=status,plans=len(rs),customers=total(rs,'Customers'),meanPlanMargin=mean([r['MarginPct'] for r in rs if number(r['MarginPct'])]),marginAtStake=total(rs,'MarginAtStake'),churnCost=total(rs,'ChurnCost')))
    weekly_rank=collections.defaultdict(list)
    for r in own: weekly_rank[r['WeekStarting']].append(r['Ranking'])
    rankdates=sorted(weekly_rank); scatter=[]; first_event=min(r['EventDate'] for r in daily);last_event=max(r['EventDate'] for r in daily)
    for i,start in enumerate(rankdates):
        end=min(start+dt.timedelta(days=6),rankdates[i+1]-dt.timedelta(days=1) if i+1<len(rankdates) else start+dt.timedelta(days=6))
        if start<first_event or end>last_event: continue
        wins=sum(r['Wins'] for r in daily if start<=r['EventDate']<=end)
        days=(end-start).days+1
        scatter.append(dict(date=iso(start),end=iso(end),days=days,rank=mean(weekly_rank[start]),wins=wins,weeklyRate=wins/days*7))
    model=None
    if len(scatter)>=5:
        xs=[r['rank'] for r in scatter];ys=[r['weeklyRate'] for r in scatter];xm=mean(xs);ym=mean(ys)
        sxx=sum((x-xm)**2 for x in xs)
        if sxx>0:
            slope=sum((x-xm)*(y-ym) for x,y in zip(xs,ys))/sxx;intercept=ym-slope*xm
            sse=sum((y-intercept-slope*x)**2 for x,y in zip(xs,ys));sst=sum((y-ym)**2 for y in ys)
            model=dict(n=len(xs),slope=slope,intercept=intercept,r2=1-sse/sst if sst else None,xMean=xm,sxx=sxx,residualVariance=sse/(len(xs)-2),tCritical=float(student_t.ppf(.975,len(xs)-2)),minRank=min(xs),maxRank=max(xs))
    losses=collections.Counter();identified={};event_counts={}
    for direction in ['loss','win']:
        rs=[r for r in detail if r['Direction']==direction]
        if any(not number(r['n']) or r['n']<0 for r in rs): raise ValueError('Invalid competitor event count')
        n=total(rs,'n');known=[r for r in rs if r['BusinessName'] and str(r['BusinessName']).lower()!='unknown/pending']
        identified[direction]=total(known,'n')/n if n else None;event_counts[direction]=n
        if direction=='loss':
            for r in known: losses[r['BusinessName']]+=r['n']
    issues=[]
    mixed=sum(customers.values());latest_count=total([r for r in usable if r['IntervalDate']==latest],'NMI_Count');base_count=total(base,'Customers')
    def issue(code,severity,text): issues.append(dict(code=code,severity=severity,message=text))
    issue('mixed-dates','warning',f'Original customer method combines front-book at {latest} with each legacy plan’s last report. This is not a single-date active customer total.')
    issue('customer-reconciliation','warning',f'Mixed-date portfolio: {mixed:,.0f}; demand at latest date: {latest_count:,.0f}; base-table customers: {base_count:,.0f}. Different snapshots have not been reconciled.')
    issue('margin-coverage','info',f'Portfolio margin uses {len(valid_base)} of {len(base)} base-table rows with numeric margin and positive annual price; unpriced rows are excluded from both sums.')
    issue('source-formulas','info','Workbook cached values are read offline. Excel formulas are not recalculated here; save a recalculated workbook before import.')
    issue('acquisition-cost','info','The source app assumes acquisition cost is $0; no acquisition-spend data was supplied, so the dashboard displays “Not measured”.')
    issue('legacy-classification','info','Closed plans are labelled legacy rather than judged on new sign-ups. Plan catalogue metadata fills missing demand metadata; any remaining unmatched plans stay visible as Unknown.')
    issue('model-window','warning',f'Ranking model uses {len(scatter)} windows, normalised to a 7-day sign-up rate. Association is not price elasticity or a causal forecast.')
    duplicate_e=sum(n-1 for n in collections.Counter((r['PlanCode'],r['IntervalDate'],r['Network'],r['CustomerType']) for r in usable).values() if n>1)
    if duplicate_e: issue('duplicate-e','warning',f'{duplicate_e} extra E rows share plan/date/network/customer-type keys; customer counts require review.')
    unreported=sum(r['asOf'] is None for r in plan_rows)
    if unreported: issue('unreported-plans','warning',f'{unreported} plans have no usable demand observation at the required date. Their zero contribution to the reported total does not prove they have no customers.')
    unknown=sum(r['network']=='Unknown' for r in plan_rows)
    if unknown: issue('unknown-metadata','warning',f'{unknown} plans have no customer snapshot metadata; retained as Unknown instead of silently dropped.')
    if event_counts['loss']!=total(daily,'Losses'): issue('loss-reconciliation','warning','Competitor loss-event totals differ from daily loss totals; compare their coverage before combining them.')
    snapshot=dict(schemaVersion=1,meta=dict(sourceFile=path.name,sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),pipelineVersion=VERSION,generatedAt=dt.datetime.now(dt.timezone.utc).isoformat(),demandAsOf=iso(latest),rankingAsOf=iso(latest_eme),eventsAsOf=iso(last_event),isSample=False),overview=dict(totalCustomers=mixed,frontBook=sum(v for k,v in customers.items() if books[k]=='Front-Book'),backBook=sum(v for k,v in customers.items() if books[k]=='Back-Book'),latestDemandCustomers=latest_count,baseTableCustomers=base_count,margin=margin,medianRank=statistics.median([r['Ranking'] for r in own if r['WeekStarting']==latest_eme]) if own else None,marginAtStake=total(legacy,'MarginAtStake'),churnCost=total(legacy,'ChurnCost'),cac=None),trend=[dict(week=iso(k),**v) for k,v in sorted(trend.items())],plans=plan_rows,elasticity=dict(points=scatter,model=model),backbook=sorted(statuses,key=lambda r:r['marginAtStake'],reverse=True),competitors=dict(lossIdentification=identified['loss'],winIdentification=identified['win'],lossEvents=event_counts['loss'],top=[dict(name=k,customers=v) for k,v in losses.most_common(10)]),quality=issues)
    # Strict JSON rejects NaN/Infinity rather than publishing misleading nulls.
    json.dumps(snapshot,allow_nan=False)
    return snapshot

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('workbook',type=Path);ap.add_argument('--output',type=Path,default=Path('private/snapshot.json'));args=ap.parse_args()
    snapshot=build(args.workbook);args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    print(f'Prepared {len(snapshot["plans"])} plans; {args.output.stat().st_size:,} bytes. Quality notes: {len(snapshot["quality"])}.')
