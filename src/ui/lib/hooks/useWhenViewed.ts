import { useEffect, useRef } from "react";

export function useWhenViewed(cb: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          cb();
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin: "0px 0px -50px 0px",
        threshold: 0,
      },
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, []);

  return ref;
}
