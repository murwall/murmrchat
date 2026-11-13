import { PaperclipIcon } from "./icons";

export function DropOverlay({ target }: { target: string }) {
  return (
    <div className="drop-overlay">
      <div className="drop-overlay-inner">
        <PaperclipIcon />
        <div>
          Drop files to share in <b>{target}</b>
        </div>
      </div>
    </div>
  );
}
