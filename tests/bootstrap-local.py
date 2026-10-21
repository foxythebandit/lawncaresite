"""Create/use only the dedicated disposable Supabase test project. No production access."""
import json, pathlib, subprocess, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = pathlib.Path('/tmp/qg-crm-test')
LOCAL.mkdir(exist_ok=True)
if not (LOCAL/'supabase/config.toml').exists():
    subprocess.run(['supabase','init','--workdir',str(LOCAL)],check=True)
    config=LOCAL/'supabase/config.toml'
    text=config.read_text()
    for a,b in [('54321','56421'),('54322','56422'),('54323','56423'),('54324','56424'),('54327','56427'),('54320','56420')]: text=text.replace(a,b)
    config.write_text(text)
files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
create=ROOT/'supabase/migrations/002_create_bookings.sql';files.remove(create);files.insert(1,create)
text=''
for path in files:
    text+=path.read_text()+'\n'
    if path==create:
        text+="alter table bookings add column status text not null default 'pending'; alter table bookings add column confirmed_date date; alter table bookings add column notes text;\n"
(LOCAL/'supabase/migrations').mkdir(exist_ok=True)
(LOCAL/'supabase/migrations/20261021000000_baseline.sql').write_text(text)
subprocess.run(['supabase','start','--workdir',str(LOCAL),'-x','realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],check=True,stdout=subprocess.DEVNULL)
cfg=json.loads(subprocess.check_output(['supabase','status','--workdir',str(LOCAL),'-o','json'],stderr=subprocess.DEVNULL))
assert cfg['API_URL']=='http://127.0.0.1:56421'
envfile=ROOT/'.env.local'
if envfile.exists() and 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56421' not in envfile.read_text():
    raise SystemExit('Refusing to overwrite an existing non-test .env.local')
env={'NEXT_PUBLIC_SUPABASE_URL':cfg['API_URL'],'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':cfg['PUBLISHABLE_KEY'],'SUPABASE_SECRET_KEY':cfg['SECRET_KEY'],'STAFF_EMAILS':'staff@example.test','INTAKE_WEBHOOK_SECRET':'local-test-only-secret-0000000000000000','CRM_BASE_URL':'http://localhost:3100','STAFF_SMS_ENABLED':'true','TWILIO_ACCOUNT_SID':'AC'+'0'*32,'TWILIO_AUTH_TOKEN':'test-only','TWILIO_FROM_NUMBER':'+15005550006','TWILIO_OWNER_PHONE':'+15005550009','TWILIO_STAFF_PHONES':'+15005550009,+15005550010'}
envfile.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
pathlib.Path('/tmp/qg-test-config.json').write_text(json.dumps(cfg))
for email,role in [('staff@example.test','staff'),('customer@example.test','customer'),('outsider@example.test','staff')]:
    body=json.dumps({'email':email,'password':'Local-test-password-123!','email_confirm':True,'app_metadata':{'role':role}}).encode()
    req=urllib.request.Request(cfg['API_URL']+'/auth/v1/admin/users',data=body,headers={'apikey':cfg['SECRET_KEY'],'Authorization':'Bearer '+cfg['SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req) as response: response.read()
    except urllib.error.HTTPError as error:
        if error.code!=422:raise
pathlib.Path('/tmp/qg-sms-mode').write_text('reject');pathlib.Path('/tmp/qg-sms-log').write_text('')
print('Disposable test services ready. Only local .test users and dummy Twilio credentials were configured.')
