"""Read-only checks of rendered SEO output; works locally or against production.

QG_SEO_BASE defaults to http://localhost:3101. No forms are submitted.
"""
import json
import os
import subprocess
import urllib.parse
import urllib.robotparser
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

BASE = os.environ.get('QG_SEO_BASE', 'http://localhost:3101').rstrip('/')
PUBLIC = 'https://quietgreen.co'
AREAS = ['south-austin', 'east-austin', 'cedar-park', 'round-rock', 'pflugerville', 'north-austin']
SERVICES = ['gutter-cleaning', 'leaf-cleanup', 'garden-beds-mulch']
assert urllib.parse.urlparse(BASE).hostname in ('localhost', '127.0.0.1', 'quietgreen.co', 'www.quietgreen.co')


def fetch(path):
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '25', BASE + path],
                            check=True, capture_output=True, text=True)
    return result.stdout


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.meta = {}
        self.links = []
        self.canonicals = []
        self.title = ''
        self.h1_count = 0
        self.ids = []
        self.schemas = []
        self.in_title = False
        self.in_schema = False
        self.schema_buffer = ''
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        if tag == 'a':
            self.links.append(attrs.get('href', ''))
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href'))
        if tag == 'meta':
            self.meta[attrs.get('name', attrs.get('property', ''))] = attrs.get('content', '')
        if tag == 'h1':
            self.h1_count += 1
        if tag == 'title':
            self.in_title = True
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.in_schema = True
            self.schema_buffer = ''

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_schema:
            self.schema_buffer += data

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag == 'script' and self.in_schema:
            self.schemas.append(json.loads(self.schema_buffer))
            self.in_schema = False


home = Page(fetch('/'))
assert home.canonicals == [PUBLIC], home.canonicals
assert home.h1_count == 1
assert 'noindex' not in home.meta.get('robots', '')
assert 'landscaping' in home.meta['description'].lower()
assert home.ids.index('map-quote') < home.ids.index('service-inquiry')
for slug in AREAS:
    assert '/areas/' + slug in home.links, slug
    area = Page(fetch('/areas/' + slug))
    assert area.canonicals == [PUBLIC + '/areas/' + slug], area.canonicals
    assert area.meta['og:url'] == PUBLIC + '/areas/' + slug
    assert area.meta['og:title'] == area.title
    assert area.h1_count == 1
    assert 'noindex' not in area.meta.get('robots', '')
    assert area.meta['og:image'].startswith(PUBLIC + '/areas/' + slug + '/opengraph-image')
    graph = [node['@type'] for s in area.schemas for node in s.get('@graph', [])]
    assert {'Service', 'BreadcrumbList', 'FAQPage'} <= set(graph), graph
    assert any('/areas/' in link and slug not in link for link in area.links), 'sibling area links'

business = next(s for s in home.schemas if s.get('@type') == 'LocalBusiness')
assert 'geo' not in business and 'openingHoursSpecification' not in business
assert business['telephone'] == '+16823528260'
for slug in SERVICES:
    page = Page(fetch('/services/' + slug))
    assert page.canonicals == [PUBLIC + '/services/' + slug], page.canonicals
    assert page.meta['og:image'].startswith(PUBLIC + '/services/' + slug + '/opengraph-image')
    graph = [node['@type'] for s in page.schemas for node in s.get('@graph', [])]
    assert {'Service', 'BreadcrumbList', 'FAQPage'} <= set(graph), graph
assert home.meta['og:image'].startswith(PUBLIC + '/opengraph-image')
assert home.meta['twitter:card'] == 'summary_large_image'
assert any(s.get('@type') == 'FAQPage' for s in home.schemas)

robots_text = fetch('/robots.txt')
robots = urllib.robotparser.RobotFileParser()
robots.parse(robots_text.splitlines())
for path in ['/admin/login', '/portal/login']:
    login = Page(fetch(path))
    assert 'noindex' in login.meta.get('robots', ''), path
    assert robots.can_fetch('Googlebot', PUBLIC + path), path
assert robots.can_fetch('Googlebot', PUBLIC + '/')

sitemap = ET.fromstring(fetch('/sitemap.xml'))
ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
urls = [el.text for el in sitemap.findall('s:url/s:loc', ns)]
assert sorted(urls) == sorted([PUBLIC, PUBLIC + '/privacy', PUBLIC + '/terms']
                           + [PUBLIC + '/areas/' + slug for slug in AREAS]
                           + [PUBLIC + '/services/' + slug for slug in SERVICES])
assert not sitemap.findall('s:url/s:lastmod', ns), 'Do not label every deploy as a content update.'
assert PUBLIC + '/sitemap.xml' in robots_text
print('PASS: homepage/6 area pages/3 service pages, crawlable area links, matching canonicals/OG metadata, honest schema, login noindex visible to crawlers, public sitemap, mowing-first order.')
