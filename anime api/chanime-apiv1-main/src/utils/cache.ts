import NodeCache from 'node-cache';
import { Redis } from '@upstash/redis';

const cache = new NodeCache({ useClones: false, checkperiod: 120 });
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;
const redisPrefix = process.env.UPSTASH_CACHE_PREFIX || 'anivault';
let redisWarningLogged = false;

const TTL = {
  mapping: parseInt(process.env.CACHE_TTL_MAPPING || '86400'),   // 24h
  episodes: parseInt(process.env.CACHE_TTL_EPISODES || '3600'),  // 1h
  stream: parseInt(process.env.CACHE_TTL_STREAM || '300'),       // 5min
};

export function cacheGet<T>(key: string): T | null {
  const localValue = cache.get<T>(key);
  if (localValue !== undefined) return localValue;
  if (!redis) return null;

  void redis.get<{ value: T }>(`${redisPrefix}:${key}`).then((shared) => {
    if (shared === null || shared === undefined || typeof shared !== 'object' || !('value' in shared)) {
      return;
    }
    cache.set(key, shared.value, Math.max(1, parseInt(process.env.CACHE_L1_TTL || '30')));
  }).catch((error) => {
    if (!redisWarningLogged) {
      redisWarningLogged = true;
      console.warn('[Cache] Upstash read failed; continuing with local cache:', error instanceof Error ? error.message : String(error));
    }
  });

  return null;
}

export function cacheSet(key: string, data: any, type: keyof typeof TTL | number = 'mapping') {
  const ttl = typeof type === 'number' ? type : TTL[type];
  cache.set(key, data, ttl);
  if (redis) {
    void redis.set(`${redisPrefix}:${key}`, { value: data }, { ex: Math.max(1, Math.ceil(ttl)) }).catch((error) => {
      if (!redisWarningLogged) {
        redisWarningLogged = true;
        console.warn('[Cache] Upstash write failed; continuing with local cache:', error instanceof Error ? error.message : String(error));
      }
    });
  }
}

export function cacheDel(key: string) {
  cache.del(key);
  if (redis) {
    void redis.del(`${redisPrefix}:${key}`).catch((error) => {
      if (!redisWarningLogged) {
        redisWarningLogged = true;
        console.warn('[Cache] Upstash delete failed; continuing with local cache:', error instanceof Error ? error.message : String(error));
      }
    });
  }
}

export function cacheStats() {
  return { ...cache.getStats(), sharedStoreEnabled: Boolean(redis) };
}
