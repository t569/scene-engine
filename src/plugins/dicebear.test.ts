import { describe, expect, it } from 'vitest';
import { dicebearOptions } from './dicebear.ts';

// Only the options mapping is tested here: it is pure, and it encodes the one
// decision in this plugin that has a real failure mode — whose clock animates
// the character. The DOM half is a parse that throws loudly on bad input.

describe('dicebearOptions', () => {
  const choice = { style: 'shapes', seed: 'user-42', animationVariant: 'fast' } as const;

  it('forces the character static inside a scene', () => {
    // Two clocks on one element is the desync the engine exists to prevent, so
    // an explicit `fast` from the user must still lose to `none` in a scene.
    expect(dicebearOptions(choice, { inScene: true }).animationVariant).toBe('none');
  });

  it('keeps the chosen loop outside a scene', () => {
    expect(dicebearOptions(choice, { inScene: false }).animationVariant).toBe('fast');
  });

  it('defaults to a medium loop outside a scene when none was chosen', () => {
    const noVariant = { style: 'shapes', seed: 'user-42' };
    expect(dicebearOptions(noVariant, { inScene: false }).animationVariant).toBe('medium');
  });

  it('passes the seed through and omits size when unset', () => {
    const opts = dicebearOptions(choice, { inScene: true });
    expect(opts.seed).toBe('user-42');
    expect('size' in opts).toBe(false);
  });

  it('coerces a numeric seed to a string', () => {
    // Regression: a user id straight off a REST API is a number (an integer
    // primary key), and DiceBear validates `seed` against a JSON
    // Schema — it throws `OptionsValidationError: /seed has an invalid type`
    // rather than coercing. Thrown during a render that kills the React tree.
    const opts = dicebearOptions({ style: 'shapes', seed: 1 }, { inScene: true });
    expect(opts.seed).toBe('1');
    expect(typeof opts.seed).toBe('string');
  });
});
