import { useState, useEffect } from 'react';

/**
 * Hook that debounces a value by a specified delay in milliseconds.
 * Useful for delaying search API requests while a user is actively typing.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
