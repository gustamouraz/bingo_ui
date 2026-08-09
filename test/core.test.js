const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, formatBall, takeNextBall } = require('../server');

test('formats each bingo range with its correct letter', () => {
  assert.equal(formatBall(1), 'B-01');
  assert.equal(formatBall(30), 'I-30');
  assert.equal(formatBall(45), 'N-45');
  assert.equal(formatBall(60), 'G-60');
  assert.equal(formatBall(75), 'O-75');
});

test('draws every ball once and completes the session', () => {
  const session = createSession({ name: 'Test', drawIntervalSeconds: 5 });
  const drawn = new Set();
  for (let index = 0; index < 75; index += 1) drawn.add(takeNextBall(session));

  assert.equal(drawn.size, 75);
  assert.equal(session.calledNumbers.length, 75);
  assert.equal(session.status, 'completed');
  assert.equal(takeNextBall(session), null);
});
