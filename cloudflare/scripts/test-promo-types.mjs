/**
 * Smoke: promo type helpers + checkout form body with coupon.
 */
import assert from 'node:assert/strict';
import {
  PROMO_TYPES,
  normalizePromoType,
  promoPercentForType,
  isDiscountPromoType,
  checkoutFormBody,
} from '../src/services/premiumService.js';

assert.equal(normalizePromoType('FREE_MONTH'), PROMO_TYPES.FREE_MONTH);
assert.equal(normalizePromoType('discount_20'), PROMO_TYPES.DISCOUNT_20);
assert.equal(normalizePromoType('nope'), null);

assert.equal(promoPercentForType(PROMO_TYPES.DISCOUNT_20), 20);
assert.equal(promoPercentForType(PROMO_TYPES.DISCOUNT_40), 40);
assert.equal(promoPercentForType(PROMO_TYPES.FREE_MONTH), null);
assert.equal(isDiscountPromoType(PROMO_TYPES.DISCOUNT_40), true);
assert.equal(isDiscountPromoType(PROMO_TYPES.FREE_DAYS), false);

const plain = checkoutFormBody({
  clientReferenceId: 'abc',
  origin: 'https://houdini-bet.pages.dev',
  priceId: 'price_x',
});
assert.match(plain, /allow_promotion_codes=true/);
assert.doesNotMatch(plain, /discounts/);

const withCoupon = checkoutFormBody({
  clientReferenceId: 'abc',
  origin: 'https://houdini-bet.pages.dev',
  priceId: 'price_x',
  couponId: 'coup_1',
  percentOff: 20,
});
assert.match(withCoupon, /discounts%5B0%5D%5Bcoupon%5D=coup_1|discounts\[0\]\[coupon\]=coup_1/);
assert.doesNotMatch(withCoupon, /allow_promotion_codes=true/);
assert.match(withCoupon, /pending_promo_percent/);

console.log('test-promo-types: ok');
