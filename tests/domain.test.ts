import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyContext, interpret, Session} from '../src/domain';

test('abstains on missing context, purrs and repeated meows alone', () => {
  for (const call of ['unknown','purr','repeated','meow'] as const) assert.equal(interpret({...emptyContext,call},'a',[]).intent,'unknown');
});
test('withdrawal overrides a tempting food context', () => {
  const result=interpret({place:'food',behavior:'retreating',call:'repeated'},'a',[]);
  assert.equal(result.intent,'space');
  assert.ok(result.alternatives.includes('food'));
});
test('a reported hiss produces a cautious space suggestion, not a medical diagnosis', () => {
  const result=interpret({...emptyContext,call:'hiss'},'a',[]);
  assert.equal(result.intent,'space');
  assert.equal('confidence' in result,false);
  assert.equal(result.version,'context-v1');
});
const context={place:'food',behavior:'looking',call:'meow'} as const;
function history(catId:string, feedback:Session['feedback'], count=3):Session[] {
  return Array.from({length:count},(_,i) => ({id:String(i),catId,createdAt:new Date().toISOString(),context,result:interpret(context,catId,[]),feedback}));
}
test('does not personalize from another cat or unconfirmed predictions', () => {
  assert.equal(interpret(context,'a',history('b','food')).personalized,false);
  assert.equal(interpret(context,'a',history('a',undefined)).personalized,false);
  assert.equal(interpret(context,'a',history('a','food',2)).personalized,false);
});
test('uses repeated matching owner feedback with an explicit caveat', () => {
  const result=interpret(context,'a',history('a','food'));
  assert.equal(result.personalized,true);
  assert.ok(result.reasons.some(v => v.includes('اثبات علمی نیستند')));
});
test('feedback cannot invent unsupported meanings or override withdrawal', () => {
  assert.equal(interpret(context,'a',history('a','play')).personalized,false);
  const withdrawing={...context,behavior:'tense'} as const;
  const previous=history('a','food').map(v => ({...v,context:withdrawing}));
  assert.equal(interpret(withdrawing,'a',previous).intent,'space');
  assert.equal(interpret(withdrawing,'a',previous).personalized,false);
});
test('classification does not mutate owner observations or previous records', () => {
  const previous=history('a','food');
  const before=JSON.stringify(previous);
  interpret(Object.freeze({...context}),'a',previous);
  assert.equal(JSON.stringify(previous),before);
});
