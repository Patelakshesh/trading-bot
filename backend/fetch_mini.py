import json
import urllib.request

url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
print("Downloading...")
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode('utf-8'))
    
    # Filter CRUDEOILM
    from datetime import datetime
    now = datetime.now()
    minis = []
    for item in data:
        if item.get('exch_seg') == 'MCX' and item.get('name') == 'CRUDEOILM':
            try:
                # expiry format: '19AUG2026' -> need to parse roughly
                expiry_str = item.get('expiry')
                minis.append(item)
            except:
                pass
    
    print("Found mini tokens:")
    for m in minis[:3]:
        print(m)
