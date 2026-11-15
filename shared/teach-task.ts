// Teach a task: the message bar's + menu entry and the `/learn` command.
// Offered again since #4208 made it work (hidden by #4209 meanwhile). This one switch
// covers the desktop app, the web app and the server, which publishes it as
// `teachTask` in GET /api/config for the phone app. Off: the + menu leaves
// the entry out, the "/" menu leaves `/learn` out, and a `/learn` typed by
// hand is sent as plain text. The run card's Save as skill is not part of it.
export const TEACH_TASK_OFFERED: boolean = true;
