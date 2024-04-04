import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCosmeticCss } from '../src/cosmetics.js';

test('builds CSS for a matching domain rule', () => {
  const css = buildCosmeticCss('news.example.com', {
    globalEnabled: true,
    siteExceptions: [],
    cosmeticRules: [{ selector: '.sponsored-card', includeDomains: ['example.com'], excludeDomains: [] }],
    cosmeticExceptions: []
  });
  assert.match(css, /\.sponsored-card\{display:none!important;/);
});

test('does not inject cosmetics when protection is globally disabled or site-paused', () => {
  const rules = [{ selector: '.sponsored-card', includeDomains: [], excludeDomains: [] }];
  assert.equal(buildCosmeticCss('example.com', { globalEnabled: false, siteExceptions: [], cosmeticRules: rules }), '');
  assert.equal(buildCosmeticCss('news.example.com', { globalEnabled: true, siteExceptions: ['example.com'], cosmeticRules: rules }), '');
});

test('cosmetic exceptions suppress the matching selector on the specified domain', () => {
  const css = buildCosmeticCss('news.example.com', {
    globalEnabled: true,
    siteExceptions: [],
    cosmeticRules: [{ selector: '.special-ad', includeDomains: [], excludeDomains: [] }],
    cosmeticExceptions: [{ domain: 'example.com', selector: '.special-ad' }]
  });
  assert.doesNotMatch(css, /\.special-ad\{/);
});
