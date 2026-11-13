import { useEffect, useRef } from "react";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

/** Full emoji picker in a popover; uses native emoji so it works offline. */
export function EmojiPopover({
  onPick,
  onClose,
  className,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={`emoji-popover ${className ?? ""}`} ref={ref}>
      <EmojiPicker
        onEmojiClick={(e) => onPick(e.emoji)}
        emojiStyle={EmojiStyle.NATIVE}
        theme={Theme.AUTO}
        lazyLoadEmojis
        width={340}
        height={400}
        previewConfig={{ showPreview: false }}
      />
    </div>
  );
}

/** A few common shortcodes for ":" autocomplete in the composer. */
export const SHORTCODES: [string, string][] = [
  ["thumbsup", "👍"], ["+1", "👍"], ["thumbsdown", "👎"], ["-1", "👎"], ["smile", "😄"], ["grin", "😁"],
  ["joy", "😂"], ["laughing", "😆"], ["wink", "😉"], ["blush", "😊"], ["heart", "❤️"], ["heart_eyes", "😍"],
  ["thinking", "🤔"], ["sweat_smile", "😅"], ["cry", "😢"], ["sob", "😭"], ["rage", "😡"], ["scream", "😱"],
  ["open_mouth", "😮"], ["confused", "😕"], ["neutral_face", "😐"], ["sunglasses", "😎"], ["upside_down", "🙃"],
  ["slightly_smiling_face", "🙂"], ["pray", "🙏"], ["clap", "👏"], ["wave", "👋"], ["ok_hand", "👌"], ["muscle", "💪"],
  ["eyes", "👀"], ["fire", "🔥"], ["tada", "🎉"], ["rocket", "🚀"], ["100", "💯"], ["white_check_mark", "✅"],
  ["heavy_check_mark", "✔️"], ["x", "❌"], ["warning", "⚠️"], ["bug", "🐛"], ["coffee", "☕"], ["beer", "🍺"],
  ["point_up", "☝️"], ["point_right", "👉"], ["raised_hands", "🙌"], ["facepalm", "🤦"], ["shrug", "🤷"],
  ["star", "⭐"], ["sparkles", "✨"], ["bulb", "💡"], ["memo", "📝"], ["calendar", "📅"], ["lock", "🔒"],
];
