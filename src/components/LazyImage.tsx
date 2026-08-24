import { useEffect, useRef, useState } from 'react';

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function LazyImage({ src, alt, className }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {!loaded && (
        <div className="h-full w-full animate-pulse bg-muted" />
      )}
      {loaded && !error && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setError(true)}
          className="h-full w-full object-cover"
        />
      )}
      {loaded && error && (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          加载失败
        </div>
      )}
    </div>
  );
}