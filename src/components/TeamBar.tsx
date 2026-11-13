import { useClient, useClientTick } from "../matrix/hooks";
import { getTeams, HOME_TEAM, teamUnread } from "../matrix/rooms";
import { Avatar } from "./Avatar";
import { HomeIcon } from "./icons";

interface Props {
  selected: string;
  onSelect: (teamId: string) => void;
}

export function TeamBar({ selected, onSelect }: Props) {
  const client = useClient();
  useClientTick();
  const teams = getTeams(client);

  const item = (id: string, name: string, mxc: string | null, index: number) => {
    const { unread, mentions } = teamUnread(client, id);
    return (
      <button
        key={id}
        className={`team ${selected === id ? "active" : ""} ${unread ? "unread" : ""}`}
        onClick={() => onSelect(id)}
        title={`${name}${index < 9 ? `  (Ctrl+Alt+${index + 1})` : ""}`}
      >
        {id === HOME_TEAM ? (
          <div className="avatar avatar-fallback home-icon" style={{ width: 40, height: 40, borderRadius: 10 }}>
            <HomeIcon />
          </div>
        ) : (
          <Avatar mxc={mxc} name={name} id={id} size={40} square />
        )}
        {mentions > 0 && <span className="badge team-badge">{mentions}</span>}
      </button>
    );
  };

  return (
    <nav className="team-bar">
      {item(HOME_TEAM, "Home (rooms not in a space)", null, 0)}
      <div className="team-sep" />
      {teams.map((t, i) => item(t.roomId, t.name, t.getMxcAvatarUrl(), i + 1))}
    </nav>
  );
}
