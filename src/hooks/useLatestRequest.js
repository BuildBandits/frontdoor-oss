import { useCallback, useEffect, useRef } from 'react';

/**
 * Guard against stale responses: `begin()` starts a new request and returns
 * `isLatest()`, which stays true only until a newer request starts, `cancel()`
 * is called or the component unmounts. Apply a response only while it is true,
 * so an older, slower answer never overwrites a newer one.
 */
export function useLatestRequest() {
  const counterRef = useRef(0);

  const begin = useCallback(() => {
    counterRef.current += 1;
    const requestId = counterRef.current;
    return () => requestId === counterRef.current;
  }, []);

  const cancel = useCallback(() => {
    counterRef.current += 1;
  }, []);

  useEffect(() => () => {
    counterRef.current += 1;
  }, []);

  return { begin, cancel };
}
