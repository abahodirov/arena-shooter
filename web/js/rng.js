// A port of CPython's random.Random (MT19937) so the maps are laid out exactly
// like the desktop version: same seed -> same trees, rocks, grass and clouds.
export class PyRandom {
  constructor(seed) {
    this.mt = new Uint32Array(624);
    this.mti = 625;
    this.initByArray([seed >>> 0]);
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.mti = 624;
  }

  initByArray(key) {
    this.initGenrand(19650218);
    const mt = this.mt, n = 624, len = key.length;
    let i = 1, j = 0;
    for (let k = Math.max(n, len); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (((mt[i] ^ Math.imul(p, 1664525)) >>> 0) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= n) { mt[0] = mt[n - 1]; i = 1; }
      if (j >= len) j = 0;
    }
    for (let k = n - 1; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (((mt[i] ^ Math.imul(p, 1566083941)) >>> 0) - i) >>> 0;
      i++;
      if (i >= n) { mt[0] = mt[n - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  uint32() {
    const mt = this.mt;
    if (this.mti >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.uint32() >>> 5, b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(a, b) { return a + (b - a) * this.random(); }

  randbelow(n) {
    const k = 32 - Math.clz32(n);
    let r = this.uint32() >>> (32 - k);
    while (r >= n) r = this.uint32() >>> (32 - k);
    return r;
  }

  choice(seq) { return seq[this.randbelow(seq.length)]; }
}
