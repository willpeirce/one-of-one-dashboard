"""Generate invented API-shaped card history. Run from the repository root."""
import copy
import datetime
import json
from pathlib import Path
root = Path('test/fixtures/shopify')
order = json.loads((root / 'order.json').read_text())['data']['order']
orders = []
session_envelope = json.loads((root / 'sessions.json').read_text())
sessions = session_envelope['data']['shopifyqlQuery']['tableData']
sessions['rows'] = []
channel_envelope = json.loads((root / 'channels.json').read_text())
channels = channel_envelope['data']['shopifyqlQuery']['tableData']
channels['rows'] = []
for index in range(400):
    day = (datetime.date(2026, 9, 30) - datetime.timedelta(days=399-index)).isoformat()
    market = 'US' if index % 3 == 0 else 'UK'
    o = copy.deepcopy(order)
    ident = 910000 + index
    o['id'] = f'gid://shopify/Order/{ident}'
    o['customer'] = {'id': f'gid://shopify/Customer/{ident}'}
    o['createdAt'] = o['updatedAt'] = day + 'T09:00:00Z'
    o['transactions'] = [{'kind':'SALE','status':'SUCCESS','processedAt':o['createdAt']}]
    o['displayFulfillmentStatus'] = 'FULFILLED' if index < 398 else 'UNFULFILLED'
    o['channelInformation'] = {'channelDefinition': {'channelName': 'TikTok' if index % 13 == 0 else 'Online Store'}}
    o['discountCodes'] = []
    o['shippingAddress'] = {'countryCodeV2':'US' if market=='US' else 'GB', 'provinceCode': 'OH' if market=='US' else 'ENG'}
    o['currencyCode'] = 'USD' if market=='US' else 'GBP'
    o['lineItems']['nodes'][0]['id'] = f'gid://shopify/LineItem/{ident}'
    if index % 5:
        o['lineItems']['nodes'][0]['product']['id'] = 'gid://shopify/Product/10476514214222'
        o['lineItems']['nodes'][0]['sku'] = 'oneofone1'
    elif day >= '2026-09-11':
        o['lineItems']['nodes'][0]['product']['id'] = 'gid://shopify/Product/16062800658766'
        o['lineItems']['nodes'][0]['sku'] = 'REFILL'
        o['customerJourneySummary']['lastVisit']['utmParameters']['campaign'] = '4750ad5e7b-EMAIL_CAMPAIGN_2026_09_11_10_52'
    if index % 4:
        o['customerJourneySummary']['lastVisit'] = None
    if index < 398:
        location = '106790781262' if market=='US' else '106790748494'
        o['fulfillments'] = [{'id':f'gid://shopify/Fulfillment/{ident}', 'status':'SUCCESS', 'createdAt':day+'T12:00:00Z', 'updatedAt':day+'T12:00:00Z', 'location':{'id':f'gid://shopify/Location/{location}'}, 'fulfillmentLineItems':{'nodes':[{'quantity':1,'lineItem':{'id':f'gid://shopify/LineItem/{ident}'}}], 'pageInfo':{'hasNextPage':False,'endCursor':None}}}]
    orders.append(o)
    channels['rows'].append([day, o['channelInformation']['channelDefinition']['channelName'], 1])
    for country, region, count, carts, checkout, paid in [('United Kingdom','England',32+index%7,8,4,int(market=='UK')),('United States','Ohio',41+index%11,5,3,int(market=='US'))]:
        sessions['rows'].append([day,country,region,'/products/kit','mobile','direct',count,carts,checkout,paid])
envelope={'data':{'orders':{'nodes':orders,'pageInfo':{'hasNextPage':False,'endCursor':None}}}}
(root / 'card-orders.json').write_text(json.dumps(envelope,separators=(',',':'))+'\n')
(root / 'card-sessions.json').write_text(json.dumps(session_envelope,separators=(',',':'))+'\n')
(root / 'card-channels.json').write_text(json.dumps(channel_envelope,separators=(',',':'))+'\n')
