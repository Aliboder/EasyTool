import { useEffect, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*";

export function ScrambleText({
  text,
  delay = 0,
  speed = 30,
  className,
}: {
  text: string;
  delay?: number;
  speed?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(text.replace(/./g, " "));

  useEffect(() => {
    let frame = 0;
    const total = text.length * 3;
    const timer = setInterval(() => {
      frame++;
      const progress = frame / total;
      const resolved = Math.floor(progress * text.length);
      const next = text
        .split("")
        .map((ch, i) => {
          if (i < resolved) return ch;
          if (ch === " ") return " ";
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join("");
      setDisplay(next);
      if (frame >= total) {
        clearInterval(timer);
        setDisplay(text);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, delay, speed]);

  return <span className={className}>{display}</span>;
}
