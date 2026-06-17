import { useEffect, useState } from "react";
import { motion } from "motion/react";

const LYRICS = [
  { original: "夜空の向こうに", translation: "Beyond the night sky" },
  { original: "君の声が聞こえる", translation: "I can hear your voice" },
  { original: "夜に駆ける", translation: "Racing through the night" },
  { original: "星が降る夜に", translation: "On a night when stars fall" },
  { original: "風が吹き抜けて", translation: "The wind sweeps through" },
  { original: "君を呼ぶ声がする", translation: "A voice calls your name" },
  { original: "遠い記憶の中で", translation: "Deep in distant memories" },
  { original: "あの日に戻りたい", translation: "I want to return to that day" },
];

const ENTRY_HEIGHT = 80;
const CENTER_SLOT = 2;

export function LyricPanel() {
  const [activeIndex, setActiveIndex] = useState(CENTER_SLOT);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIndex((i) => (i + 1) % LYRICS.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <div className="lyric-window">
        <motion.div
          className="lyric-track"
          animate={{ y: (CENTER_SLOT - activeIndex) * ENTRY_HEIGHT }}
          transition={{ type: "spring", stiffness: 280, damping: 32 }}
        >
          {LYRICS.map((lyric, i) => {
            const distance = Math.abs(i - activeIndex);
            const opacity = distance === 0 ? 1 : distance === 1 ? 0.45 : 0.2;
            const scale = distance === 0 ? 1 : 0.94;
            return (
              <motion.div
                key={i}
                className="lyric-entry"
                animate={{ opacity, scale }}
                transition={{ duration: 0.35 }}
              >
                <div className="lyric-original">{lyric.original}</div>
                <div className="lyric-translation">{lyric.translation}</div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
