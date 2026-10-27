"""One-time, serial public-provider audit. Cached; never run automatically by CI.
Run: python3 tests/address-reliability/benchmark.py
Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
"""
import json
import time
import subprocess
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).parent
CASES = [
    ('jim', '162 Danish Dr, Hutto, TX 78634', 'house', [30.5106347, -97.5865912]),
    ('jim-no-city', '162 Danish Dr, TX 78634', 'house-variant', [30.5106347, -97.5865912]),
    ('office', '807 E 47th St, Austin, TX', 'house', None),
    ('austin-city-hall', '301 W 2nd St, Austin, TX 78701', 'civic', None),
    ('hutto-city-hall', '500 W Live Oak St, Hutto, TX 78634', 'civic', None),
    ('hutto-no-zip', '500 W Live Oak St, Hutto, TX', 'civic', None),
    ('round-rock-library', '200 E Liberty Ave, Round Rock, TX 78664', 'civic', None),
    ('cedar-park-library', '425 S Parkwest Dr, Cedar Park, TX 78613', 'civic', None),
    ('leander-city-hall', '105 N Brushy St, Leander, TX 78641', 'civic', None),
    ('pflugerville-city-hall', '100 E Main St, Pflugerville, TX 78660', 'civic', None),
    ('jim-partial', '162 Danish', 'partial', None),
    ('jim-road', 'Danish Dr, Hutto, TX', 'road', None),
    ('fake-number', '999999 Danish Dr, Hutto, TX 78634', 'negative', None),
    ('fake-street', '123 Imaginary Unicorn Lane, Hutto, TX 78634', 'negative', None),
    ('out-of-area', '1600 Pennsylvania Ave NW, Washington, DC', 'civic-outside', None),
]


def main():
    cache_path = ROOT / 'provider-results.json'
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    cache = {key: value for key, value in cache.items() if value.get('status') is not None}
    stopped = {key.split(':')[0] for key, value in cache.items() if value.get('status') in (429, 403)}
    for case_id, query, kind, truth in CASES:
        for provider in ('photon', 'nominatim'):
            key = provider + ':' + case_id
            if key in cache or provider in stopped:
                continue
            if provider == 'photon':
                url = 'https://photon.komoot.io/api/?' + urllib.parse.urlencode(dict(q=query, limit=10, lang='en', lat=30.3049, lon=-97.7184))
            else:
                url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(dict(format='json', q=query, limit=1, countrycodes='us', viewbox='-98.3184,30.8049,-97.1184,29.8049', bounded=0))
            record = dict(query=query, kind=kind, ground_truth=truth, url=url)
            start = time.monotonic()
            try:
                result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '10', '--user-agent', 'QuietGreen-address-reliability-one-time-audit/1.0 (local developer verification)', '--header', 'Accept-Language: en', '--write-out', '\n%{http_code}', url], capture_output=True, text=True, check=True)
                body, status = result.stdout.rsplit('\n', 1)
                record.update(status=int(status))
                if int(status) in (429, 403):
                    stopped.add(provider)
                record['response'] = json.loads(body)
            except Exception as error:
                record.update(error=str(error), status=getattr(error, 'code', record.get('status')))
                if record['status'] in (429, 403):
                    stopped.add(provider)
            record['latency_ms'] = round((time.monotonic()-start)*1000)
            cache[key] = record
            cache_path.write_text(json.dumps(cache, indent=2) + '\n')
            print(key, record['status'], record['latency_ms'], flush=True)
            time.sleep(1.2)


if __name__ == '__main__':
    main()
