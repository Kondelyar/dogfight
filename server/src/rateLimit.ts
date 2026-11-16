export interface Bucket {
  take(): boolean;
}

export interface BucketOptions {
  perSecond: number;
  burst?: number;
  now?: () => number;
}

export function createBucket({
  perSecond,
  burst = perSecond,
  now = Date.now,
}: BucketOptions): Bucket {
  let tokens = burst;
  let last = now();

  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
