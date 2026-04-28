import { useEffect, useState } from 'react';

export default function ImageWithFallback({ src, alt, fallback, ...props }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return fallback || null;
  }

  return <img src={src} alt={alt} onError={() => setFailed(true)} {...props} />;
}
