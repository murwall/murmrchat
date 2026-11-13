const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const HashIcon = () => (
  <svg {...base}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>
);
export const LockIcon = () => (
  <svg {...base}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const ThreadIcon = () => (
  <svg {...base}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z" /></svg>
);
export const SmileIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>
);
export const ReplyIcon = () => (
  <svg {...base}><path d="m9 14-5-5 5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v5" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const ShieldIcon = () => (
  <svg {...base}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /></svg>
);
export const UsersIcon = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>
);
export const PaperclipIcon = () => (
  <svg {...base}><path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7" /></svg>
);
export const SendIcon = () => (
  <svg {...base}><path d="M4 12 20 4l-4 16-4-7-8-1Z" /></svg>
);
export const FileIcon = () => (
  <svg {...base} width={28} height={28}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></svg>
);
export const HomeIcon = () => (
  <svg {...base} width={20} height={20}><path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" /></svg>
);
export const EditIcon = () => (
  <svg {...base}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></svg>
);
export const TrashIcon = () => (
  <svg {...base}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
);
export const SearchIcon = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const PlusIcon = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const BellIcon = () => (
  <svg {...base}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const BellOffIcon = () => (
  <svg {...base}><path d="M8.7 3A6 6 0 0 1 18 8c0 2.7.6 4.6 1.3 6M17 17H3s3-2 3-9c0-.8.1-1.5.4-2.2" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" /></svg>
);
export const PinIcon = () => (
  <svg {...base}><path d="M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2l3-3.2Z" /></svg>
);
export const BookmarkIcon = ({ filled }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"}><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" /></svg>
);
export const MoreIcon = () => (
  <svg {...base}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>
);
