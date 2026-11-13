import { useClient } from "../matrix/hooks";
import { useMediaUrl } from "../matrix/media";
import { userColor } from "../util/format";

interface Props {
  mxc?: string | null;
  name: string;
  id: string;
  size?: number;
  square?: boolean;
}

export function Avatar({ mxc, name, id, size = 32, square }: Props) {
  const client = useClient();
  const px = Math.ceil(size * window.devicePixelRatio);
  const url = useMediaUrl(client, mxc ? { mxc } : null, { w: px, h: px, method: "crop" });
  const letter = (name.replace(/^[@#!+]/, "")[0] ?? "?").toUpperCase();
  const style = {
    width: size,
    height: size,
    borderRadius: square ? Math.round(size / 4) : "50%",
    fontSize: Math.round(size * 0.45),
    background: url ? undefined : userColor(id),
  };
  return url ? (
    <img className="avatar" src={url} alt="" style={style} />
  ) : (
    <div className="avatar avatar-fallback" style={style} aria-hidden>
      {letter}
    </div>
  );
}
