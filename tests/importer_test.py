import sys, unittest, datetime as dt, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_workbook import build
class Sheet:
    def __init__(self,rows):
        self.rows=rows
    @property
    def values(self):
        heads=list(self.rows[0]);return iter([heads]+[[r.get(k) for k in heads] for r in self.rows])
class Workbook(dict):
    def close(self): pass
class ImportTests(unittest.TestCase):
    def fixture(self):
        day=dt.datetime(2026,8,20)
        demand=lambda code,channel,count,d=day:dict(PlanCode=code,Channel=channel,IntervalDate=d,Suppressed=0,NMI_Count=count,Network='Grid',CustomerType='RESI')
        return Workbook({
          'Operating_Plans w Price and Cos':Sheet([dict(PlanCode='A',PlanIsActive=1,Network='Grid',CustomerType='Residential'),dict(PlanCode='B',PlanIsActive=0,Network='Grid',CustomerType='Residential')]),
          'plan_demand_counts':Sheet([demand('A','E',10),demand('A','E_CL',10),demand('B','E',2,day-dt.timedelta(days=20))]),
          'winloss_daily':Sheet([dict(EventDate=day,PlanCode='A',Wins=3,Losses=4)]),
          'Weekly EME Ranking Data (Histor':Sheet([dict(WeekStarting=day,Grid='Grid',CustomerType='RESIDENTIAL',Ranking=5,RetailerCount=20,IsFlipped=1)]),
          'base table':Sheet([{'PlanCode':'A','Customers':10,'AnnualPrice':100,'Margin$':20,'MarginPct':.2,'Status':'Front book','MarginAtStake':0,'ChurnCost':0},{'PlanCode':'B','Customers':2,'AnnualPrice':200,'Margin$':None,'MarginPct':None,'Status':'Hold','MarginAtStake':5,'ChurnCost':3}]),
          'winloss_detail':Sheet([dict(Direction='loss',BusinessName='Known',n=3),dict(Direction='loss',BusinessName='unknown/pending',n=1),dict(Direction='win',BusinessName='unknown/pending',n=3)])
        })
    def run_build(self,workbook):
        with tempfile.NamedTemporaryFile() as f,patch('import_workbook.openpyxl.load_workbook',return_value=workbook):
            return build(Path(f.name))
    def test_meter_dedup_and_mixed_dates(self):
        s=self.run_build(self.fixture());self.assertEqual(s['overview']['totalCustomers'],12);self.assertEqual(s['overview']['frontBook'],10);self.assertEqual(s['overview']['backBook'],2)
    def test_margin_uses_matched_numerator_denominator(self):
        s=self.run_build(self.fixture());self.assertAlmostEqual(s['overview']['margin'],.2)
    def test_competitor_rate_is_event_weighted(self):
        s=self.run_build(self.fixture());self.assertEqual(s['competitors']['lossIdentification'],.75)
    def test_missing_models_stay_unavailable(self):
        self.assertIsNone(self.run_build(self.fixture())['elasticity']['model'])
    def test_invalid_counts_fail_import(self):
        w=self.fixture();w['winloss_daily'].rows[0]['Wins']=-1
        with self.assertRaises(ValueError):self.run_build(w)
if __name__=='__main__':unittest.main()
