"""Build an insert-only staging manifest without changing approved prices or publishing."""
from pathlib import Path
from decimal import Decimal
import json, hashlib, argparse

parser=argparse.ArgumentParser()
parser.add_argument('--packet',required=True)
parser.add_argument('--fresh-audit',required=True)
parser.add_argument('--out',required=True)
args=parser.parse_args()
packet_path=Path(args.packet); packet=json.loads(packet_path.read_text(encoding='utf-8'))
fresh_path=Path(args.fresh_audit); fresh={r['sku']:r for r in json.loads(fresh_path.read_text(encoding='utf-8'))}
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
digest=hashlib.sha256(packet_path.read_bytes()).hexdigest()
def cents(v):
    d=Decimal(str(v))*100
    if d!=d.to_integral_value():raise ValueError(f'Non-cent pack price: {v}')
    return int(d)
rows=[]
for p in packet['products']:
    if not p.get('canPrice') or not p.get('retailPack') or not p.get('tradePack'):continue
    sku=p['sku'];f=fresh[sku];pack=int(p['pack'])
    excluded=bool(p.get('exclusionReason'))
    holds=list(dict.fromkeys(p.get('holdReasons',[])+p.get('blockReasons',[])+f.get('blockers',[])+[
        'NOT_ORDERABLE_STAGING_ONLY','SUPPLIER_POLICY_AND_RIGHTS_REVIEW','CHECKOUT_AND_DELIVERY_INTEGRATION_REQUIRED']))
    if p.get('pricingRegime')=='MAP_BASED_10_PERCENT_TRADE':holds.append('EXPLICIT_MARGIN_POLICY_REQUIRED')
    images=p.get('imageUrls',[])[:24]
    title=p.get('productTitle') or p['louieMaeName']
    # Supplier home URL identifies source only; no fabricated product detail URL.
    if not p.get('description'):holds.append('PRODUCT_DESCRIPTION_MISSING')
    draft={'name':title,'description':p.get('description') or '','category':p['category'],
      'images':images,'referenceImages':images,'sourceUrl':'https://www.zuomod.com/',
      'supplierName':'Zuo','supplierContact':'','facts':json.dumps({'supplierSku':sku,'supplierName':p['supplierName'],
      'materials':p.get('materials'),'productDimensions':p.get('productDimensionsText'),
      'commissionCategory':p.get('commissionCategory')},ensure_ascii=False),
      'packaging':json.dumps({'unitsPerSellUnit':pack,'sellUnit':'supplier_master_pack','cartons':p.get('cartons',[]),
      'shippingMethod':p.get('ship'),'assemblyInstructionsUrl':p.get('assemblyInstructionsUrl')},ensure_ascii=False),
      'currency':'USD','usdRate':1,'variants':[{'id':sku,'name':p.get('color') or 'Default','sku':sku,
      'cost':float(Decimal(str(p['costEach']))*pack),'minimum':1,'increment':1,
      'retail':cents(p['retailPack']),'commercial':cents(p['tradePack']),**({'image':images[0]} if images else {})}],
      'conflicts':holds,'factsApproved':False,'imagesApproved':False,'referencePermission':False}
    evidence={'packetSha256':digest,'packetVersion':packet['settings']['version'],'originalSupplierName':p['supplierName'],
      'mapEach':p.get('mapEach'),'mapMasterPack':p.get('mapMasterPack'),'mapStatus':p.get('mapStatus'),
      'supplierCostSource':p.get('costSource'),'pricingRegime':p.get('pricingRegime'),
      'contributionTarget':p.get('contributionTarget'),'retailReferralMargin':p.get('retailReferralMargin'),
      'tradeMargin':p.get('tradeMargin'),'deliveryAllowanceEach':p.get('deliveryAllowanceEach'),
      'handlingAllowanceEach':p.get('handlingAllowanceEach'),'deliveryProfile':p.get('deliveryProfile'),
      'freshObservation':f,'stockUnitBasis':p.get('inventoryQuantityUnit'),'sourceImageUrls':images}
    rows.append({'sku':sku,'pack':pack,'draft':draft,'sourceEvidence':json.dumps(evidence,ensure_ascii=False,separators=(',',':')),
      'excluded':excluded,'exclusionReasons':[p['exclusionReason']] if excluded else [],'holdReasons':holds})
assert len(rows)==803 and len({r['sku'] for r in rows})==803
manifest={'runId':'zuo-priced-staging-20261107','manifestSha256':digest,'rows':rows}
(out/'staging-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
summary={'rows':len(rows),'excluded':sum(r['excluded'] for r in rows),'nonexcluded':sum(not r['excluded'] for r in rows),
 'sourcePacketSha256':digest,'publicationEnabled':False,'priceBasis':'sellable pack','currentPricesUnchanged':True}
(out/'staging-manifest-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary))
