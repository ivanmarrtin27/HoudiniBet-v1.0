/** Unit checks for authService password hashing (no D1). */
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePhone,
  validateName,
  validatePassword,
  validateUsername,
  normalizeEmail,
  normalizeUsername,
} from '../src/services/authService.js';

assert.equal(normalizeEmail('  A@B.Com '), 'a@b.com');
assert.equal(validateEmail('bad').ok, false);
assert.equal(validateEmail('ok@example.com').ok, true);
assert.equal(validateName('A').ok, false);
assert.equal(validateName('María').ok, true);
assert.equal(validatePassword('short').ok, false);
assert.equal(validatePassword('longenough').ok, true);
assert.equal(validatePhone('612345678').ok, true);
assert.equal(validatePhone('+34 612 345 678').ok, true);
assert.equal(validatePhone('12').ok, false);
assert.equal(validatePhone('', { required: false }).phone, null);
assert.equal(normalizeUsername('  Usuario_01 '), 'usuario_01');
assert.equal(validateUsername('ab').ok, false);
assert.equal(validateUsername('User!').ok, false);
assert.equal(validateUsername('usuario01').ok, true);
assert.equal(validateUsername('Usuario01').username, 'usuario01');

const stored = await hashPassword('secreto123');
assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
assert.equal(await verifyPassword('secreto123', stored), true);
assert.equal(await verifyPassword('wrong', stored), false);

console.log('ok: auth crypto + validators');
