// The Settings page's sections: their address (settings.html#<id>), name and one-line help. Data
// only, with nothing that touches the page, so any page can read it: settings-tabs.js lays the
// Settings page out from it, and the Ctrl+K search (command-palette.js, loaded on every page) lists
// the sections from it. It used to live in settings-tabs.js, whose layout code then ran on every
// page and emptied Users & access, which shares the Settings page's .st-main.
export const TABS = [
  { id: 'recording', label: 'Recording', help: 'What each camera records, and how long it is kept.' },
  { id: 'storage', label: 'Storage', help: 'How full each place is and how long it will last; your drives and shares; when old footage is cleared.' },
  { id: 'overlay', label: 'On-screen text', help: 'The camera name and the time drawn over the picture.' },
  { id: 'alerts', label: 'Alerts', help: 'Who is told when something goes wrong, and how.' },
  { id: 'links', label: 'Camera links', help: 'RTSP addresses of the cameras for VLC, another recorder or video-analytics software, and the keys that let them in.' },
  { id: 'connector', label: 'Remote sites', help: 'The installer that connects a site server, and its NVRs, to this app over Tailscale.' },
  { id: 'directory', label: 'Active Directory', help: 'Staff sign in with their Windows account; their AD group decides what they may do.' },
  { id: 'licence', label: 'Licence', help: 'This server’s licence, and the fingerprint to send for a Pro licence.' },
  { id: 'server', label: 'Server', help: 'Restart the server.' }
]

/** The section an address names ("#storage" or "storage"); anything else is the first, Recording. */
export function tabFor(hash) {
  const id = String(hash ?? '').replace(/^#/, '')
  return TABS.find((t) => t.id === id) ?? TABS[0]
}
