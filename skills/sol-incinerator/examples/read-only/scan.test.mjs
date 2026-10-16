import test from 'node:test';
import assert from 'node:assert/strict';
import {scan} from './scan.mjs';
const wallet = '11111111111111111111111111111111';
const ok = () => new Response(JSON.stringify({jsonrpc:'2.0',id:0,result:{context:{slot:1},value:[]}}));
test('uses exactly two finalized parsed read calls, no hosted relay', async () => {
  const calls = [];
  const report = await scan(wallet, 'https://rpc.example', async (url, init) => {
    assert.equal(url.origin, 'https://rpc.example');
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(body.method, 'getTokenAccountsByOwner');
    assert.equal(body.params[0], wallet);
    assert.deepEqual(body.params[2], {encoding:'jsonParsed',commitment:'finalized'});
    return ok();
  });
  assert.equal(new Set(calls.map(x=>x.params[1].programId)).size, 2);
  assert.equal(report.complete, true);
  assert.equal(report.totals.candidateLamports, 0n);
});
test('failed, invalid and JSON-RPC error responses stay incomplete without leaking provider text', async () => {
  for (const failure of [() => new Response('',{status:429}), () => new Response('broken'),
    () => new Response(JSON.stringify({error:{message:'secret-key'}})), () => {throw Error('secret-key');}]) {
    let i = 0;
    const report = await scan(wallet, 'https://rpc.example', async () => ++i===1 ? ok() : failure());
    assert.equal(report.complete, false);
    assert.equal(JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v).includes('secret-key'),false);
  }
});
test('invalid address and unsafe URL rejected before networking', async () => {
  const noNetwork = () => {throw Error('unexpected network');};
  await assert.rejects(scan('bad', 'https://rpc.example', noNetwork));
  await assert.rejects(scan(wallet, 'http://remote.example', noNetwork));
  await assert.rejects(scan(wallet, 'file:///tmp/data', noNetwork));
});
