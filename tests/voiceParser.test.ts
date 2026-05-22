// tests/voiceParser.test.ts
// Run: npx tsx tests/voiceParser.test.ts

import { buildVoiceParseInput, parseVoiceParseResponse } from '@/lib/voiceParser';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const opts = {
  services: [
    'Flat Tire Repair', 'Tire Replacement',
    'Brake Pad Replacement', 'Full Detail', 'Battery Replacement',
  ],
  vehicleTypes: ['Car', 'SUV', 'Truck', 'Van'],
};

console.log('\n┌─ buildVoiceParseInput ────────────────────────────');
{
  const inp = buildVoiceParseInput('hello world', {
    vertical: 'tire', services: ['A', 'B'], vehicleTypes: ['Car'],
  });
  check('transcript / vertical / services / vehicleTypes pass through',
    inp.transcript === 'hello world'
    && inp.vertical === 'tire'
    && JSON.stringify(inp.allowed.services) === JSON.stringify(['A', 'B'])
    && JSON.stringify(inp.allowed.vehicleTypes) === JSON.stringify(['Car']));
  check('paymentMethods + conditions hard-coded',
    JSON.stringify(inp.allowed.paymentMethods) === JSON.stringify(
      ['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check'])
    && JSON.stringify(inp.allowed.conditions) === JSON.stringify(
      ['emergency', 'lateNight', 'highway', 'weekend']));
}

console.log('\n┌─ parseVoiceParseResponse ─────────────────────────');
check('clean tire-job JSON → all fields validated and kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Tire Replacement","quantity":2,"vehicleType":"SUV",' +
      '"vehicleMakeModel":"BMW X5","location":"Aventura","paymentMethod":"cash"}',
      opts);
    return r.ok && r.fields.service === 'Tire Replacement'
      && r.fields.quantity === 2 && r.fields.vehicleType === 'SUV'
      && r.fields.vehicleMakeModel === 'BMW X5'
      && r.fields.location === 'Aventura'
      && r.fields.paymentMethod === 'cash';
  })());
check('JSON inside markdown fences extracted',
  (() => {
    const r = parseVoiceParseResponse(
      '```json\n{"service":"Flat Tire Repair"}\n```', opts);
    return r.ok && r.fields.service === 'Flat Tire Repair';
  })());
check('non-JSON → unparseable',
  (() => {
    const r = parseVoiceParseResponse('not json', opts);
    return !r.ok && r.error === 'unparseable';
  })());
check('non-object JSON (array) → malformed',
  (() => {
    const r = parseVoiceParseResponse('["x"]', opts);
    return !r.ok && r.error === 'malformed';
  })());
check('{} → empty_result',
  (() => {
    const r = parseVoiceParseResponse('{}', opts);
    return !r.ok && r.error === 'empty_result';
  })());
check('mechanic-job phrasing kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Brake Pad Replacement",' +
      '"vehicleMakeModel":"2018 Honda Accord","revenue":420,"paymentMethod":"card"}',
      opts);
    return r.ok && r.fields.service === 'Brake Pad Replacement'
      && r.fields.vehicleMakeModel === '2018 Honda Accord'
      && r.fields.revenue === 420 && r.fields.paymentMethod === 'card';
  })());
check('detailing-job phrasing kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Full Detail","vehicleMakeModel":"Tesla","location":"Miami Gardens"}',
      opts);
    return r.ok && r.fields.service === 'Full Detail'
      && r.fields.vehicleMakeModel === 'Tesla'
      && r.fields.location === 'Miami Gardens';
  })());
check('incomplete speech (just service) kept',
  (() => {
    const r = parseVoiceParseResponse('{"service":"Flat Tire Repair"}', opts);
    return r.ok && Object.keys(r.fields).length === 1
      && r.fields.service === 'Flat Tire Repair';
  })());
check('case-insensitive service match keeps canonical casing',
  (() => {
    const r = parseVoiceParseResponse('{"service":"tire replacement"}', opts);
    return r.ok && r.fields.service === 'Tire Replacement';
  })());
check('invalid service id dropped, other fields kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Barbecue","quantity":2}', opts);
    return r.ok && r.fields.service === undefined && r.fields.quantity === 2;
  })());
check('invalid vehicleType dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"vehicleType":"Spaceship","quantity":2}', opts);
    return r.ok && r.fields.vehicleType === undefined && r.fields.quantity === 2;
  })());
check('invalid paymentMethod dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"paymentMethod":"crypto","quantity":2}', opts);
    return r.ok && r.fields.paymentMethod === undefined && r.fields.quantity === 2;
  })());
check('conditions filter keeps known members',
  (() => {
    const r = parseVoiceParseResponse(
      '{"conditions":["emergency","barbecue","highway"]}', opts);
    return r.ok && JSON.stringify(r.fields.conditions) === JSON.stringify(['emergency', 'highway']);
  })());
check('conditions all invalid → field dropped → empty_result',
  (() => {
    const r = parseVoiceParseResponse(
      '{"conditions":["barbecue","sundae"]}', opts);
    return !r.ok && r.error === 'empty_result';
  })());
check('revenue 50000 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":50000}', opts);
    return r.ok && r.fields.revenue === undefined;
  })());
check('revenue -5 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":-5}', opts);
    return r.ok && r.fields.revenue === undefined;
  })());
check('revenue 10000 (boundary) kept',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","revenue":10000}', opts);
    return r.ok && r.fields.revenue === 10000;
  })());
check('quantity 99 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":99}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('quantity 0 dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":0}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('non-integer quantity (2.5) dropped',
  (() => {
    const r = parseVoiceParseResponse(
      '{"service":"Flat Tire Repair","quantity":2.5}', opts);
    return r.ok && r.fields.quantity === undefined;
  })());
check('tireSize over 30 chars dropped',
  (() => {
    const big = 'x'.repeat(31);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","tireSize":"${big}"}`, opts);
    return r.ok && r.fields.tireSize === undefined;
  })());
check('vehicleMakeModel over 80 chars dropped',
  (() => {
    const big = 'x'.repeat(81);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","vehicleMakeModel":"${big}"}`, opts);
    return r.ok && r.fields.vehicleMakeModel === undefined;
  })());
check('notes over 500 chars dropped',
  (() => {
    const big = 'x'.repeat(501);
    const r = parseVoiceParseResponse(
      `{"service":"Flat Tire Repair","notes":"${big}"}`, opts);
    return r.ok && r.fields.notes === undefined;
  })());
check('prose around JSON still extracts the object',
  (() => {
    const r = parseVoiceParseResponse(
      'Sure thing — {"service":"Flat Tire Repair"} done', opts);
    return r.ok && r.fields.service === 'Flat Tire Repair';
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
