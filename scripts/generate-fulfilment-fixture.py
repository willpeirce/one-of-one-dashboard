"""Invented sample ExportOrders CSV. Regenerate from the repo root; no real figures."""
import csv, json
from pathlib import Path
orders = json.loads(Path('test/fixtures/shopify/card-orders.json').read_text())['data']['orders']['nodes'][-39:]
header = ['Despatched','Reference','Boxed Weight','Postage Method','Postage Charge','Line Total','Fulfilment Centre','Carrier','Country','Customer Postage Cost']
with Path('test/fixtures/fulfilment/sample.csv').open('w') as f:
    writer=csv.writer(f,lineterminator='\n');writer.writerow(header)
    for i,o in enumerate(orders):
        us=o['currencyCode']=='USD'
        postage=6.4 if us else 3.2
        pick=1.6
        if i==33: postage*=3
        service='Invented Experimental' if i==35 else 'Ground Advantage' if us else 'Royal Mail Tracked 48'
        writer.writerow([o['createdAt'][:10]+' 14:00:00',o['name'][1:],'0.420 kg',service,f'{postage:.2f}',f'{postage+pick:.4f}','Columbus' if us else 'Northampton 2','USPS' if us else 'Royal Mail','US' if us else 'GB','0.00'])
    writer.writerow(['2026-09-30 15:00:00','99999999','74 g','Royal Mail Tracked 48','3.20','4.8000','Northampton 2','Royal Mail','GB','0.00'])
    writer.writerow(['2026-09-30 16:00:00',orders[-1]['name'][1:],'0.420 kg','USPS GroundAdvantage','6.40','8.0000','Columbus','USPS','US','0.00'])
