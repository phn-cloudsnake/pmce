import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Project setup verification', () => {
  it('should have vitest working', () => {
    expect(true).toBe(true);
  });

  it('should have fast-check available', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return typeof n === 'number';
      })
    );
  });
});
