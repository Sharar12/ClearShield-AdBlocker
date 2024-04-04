import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFilterTexts, isSafeCosmeticSelector } from '../src/filter-engine.js';

test('compiles a basic domain block rule', () => {
  const result = compileFilterTexts(['||ads.example.com^']);
  assert.equal(result.networkRuleCount, 1);
  assert.equal(result.dynamicRules[0].action.type, 'block');
  assert.equal(result.dynamicRules[0].condition.urlFilter, '||ads.example.com^');
});

test('compiles allow rules above ordinary blocks', () => {
  const result = compileFilterTexts(['||ads.example.com^', '@@||trusted.example.com^']);
  assert.equal(result.dynamicRules.length, 2);
  const allow = result.dynamicRules.find(rule => rule.action.type === 'allow');
  const block = result.dynamicRules.find(rule => rule.action.type === 'block');
  assert.ok(allow.priority > block.priority);
});

test('maps resource types, third-party and domain scopes', () => {
  const result = compileFilterTexts(['||tracker.example^$script,third-party,domain=news.example|~shop.example']);
  const rule = result.dynamicRules[0];
  assert.deepEqual(rule.condition.resourceTypes, ['script']);
  assert.equal(rule.condition.domainType, 'thirdParty');
  assert.deepEqual(rule.condition.initiatorDomains, ['news.example']);
  assert.deepEqual(rule.condition.excludedInitiatorDomains, ['shop.example']);
});

test('converts cosmetic filters and scopes them to domains', () => {
  const result = compileFilterTexts(['news.example##.ad-slot', '##[data-ad-slot]', '~trusted.example,news.example##.sponsored']);
  assert.equal(result.cosmeticRuleCount, 3);
  assert.deepEqual(result.cosmeticRules[0], { selector: '.ad-slot', includeDomains: ['news.example'], excludeDomains: [] });
  assert.deepEqual(result.cosmeticRules[1], { selector: '[data-ad-slot]', includeDomains: [], excludeDomains: [] });
  assert.deepEqual(result.cosmeticRules[2], { selector: '.sponsored', includeDomains: ['news.example'], excludeDomains: ['trusted.example'] });
});

test('skips procedural syntax and unknown modifiers conservatively', () => {
  const result = compileFilterTexts([
    '||tracker.example^$removeparam=ref',
    'example.com##div:-abp-contains(ad)',
    '||ads.example^$unknownmodifier'
  ]);
  assert.equal(result.networkRuleCount, 0);
  assert.equal(result.cosmeticRuleCount, 0);
});

test('cosmetic selector guard blocks style injection syntax', () => {
  assert.equal(isSafeCosmeticSelector('.article-ad'), true);
  assert.equal(isSafeCosmeticSelector('div{background:url(https://example.invalid)}'), false);
  assert.equal(isSafeCosmeticSelector('div:has-text(ad)'), false);
});

test('badfilter cancels a matching rule regardless of line order', () => {
  const result = compileFilterTexts([
    '||tracker.example^$script',
    '||tracker.example^$script,badfilter',
    '||keep.example^'
  ]);
  assert.equal(result.networkRuleCount, 1);
  assert.equal(result.dynamicRules[0].condition.urlFilter, '||keep.example^');
});

test('important blocks outrank ordinary allow rules', () => {
  const result = compileFilterTexts([
    '@@||ads.example.com^',
    '||ads.example.com^$important'
  ]);
  const allow = result.dynamicRules.find(rule => rule.action.type === 'allow');
  const block = result.dynamicRules.find(rule => rule.action.type === 'block');
  assert.ok(block.priority > allow.priority);
});

test('document exceptions compile to main-frame allow rules', () => {
  const result = compileFilterTexts(['@@||trusted.example.com^$document']);
  assert.equal(result.networkRuleCount, 1);
  assert.equal(result.dynamicRules[0].action.type, 'allow');
  assert.deepEqual(result.dynamicRules[0].condition.resourceTypes, ['main_frame']);
});
