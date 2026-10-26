// The chat-widget tools of the agents catalog (check_widget: the ```widget
// self-check of server/widget-check.ts; show_widget, update_widget)
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md), spread into
// TOOL_DEFINITIONS in agents-catalog.ts. Definitions only, like that file;
// agents-call-cards.ts carries a call out and server/chat-widgets.ts stores
// the result. Every word here is sent to the model on every turn and pinned
// by agents-catalog-wire.test.ts.
export const WIDGET_TOOL_DEFINITIONS = [
  {
    name: "check_widget",
    description:
      "Check a ```widget before you show it: pass the exact HTML of the fence. It is drawn as the chat draws it (desktop and phone width, light and dark) and you get its defects back with a small screenshot: JavaScript errors, overflow, overlapping or crushed text, hidden or too small controls, low contrast, horizontal scroll. Read the report, fix every defect and check again until it passes (3 checks per turn), then show the HTML that passed. Never show an unchecked ```widget.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: { type: "string", description: "The widget's HTML, CSS and JavaScript, exactly as it goes in the ```widget fence." },
      },
      required: ["html"],
    },
  },
  {
    name: "show_widget",
    description:
      "Show an interactive widget in this chat. Reach for it yourself, without being asked, whenever you need details from the person or are offering a choice: never ask them to type a date, a time, a length or one of a few options. \"Help me book a call\" gets a Card with a DatePicker, a TimePicker, a Select for the length and a Textarea for an optional note; \"remind me every weekday\" gets a TimePicker and a DayPicker. Also good for a confirmation, a live status or a short pick-one list. Data, comparisons and results go in a markdown table in your message instead, which the chat can copy and export. `widget` is one JSON tree. The root is {type:\"Card\"|\"ListView\", title?, caption?, children:[...], confirm?:{label,action}, cancel?:{label,action}}. Nodes: Row, Col, Box, Spacer, Divider, Text, Title, Caption, Markdown, Badge{label,color}, Icon{name}, Image{src}, Progress{value 0-1, or value and max}, Chart{data,series:[{type,dataKey}],xAxis}, Button{label,onClickAction}, Form{onSubmitAction,children}. Fields, each with a name and a short label: Select|RadioGroup{options:[{label,value}]}, DatePicker{min?,max?} (YYYY-MM-DD), TimePicker{min?,max?,step?} (HH:MM, 24-hour), DayPicker (days of the week, sent as \"mon,wed,fri\"), Checkbox, Input, Textarea. A ListView holds ListViewItem{children}; to have the person choose one row, give the ListView a name and each row a value, and confirm sends the pick. An action is {type,payload?}; {type:\"open_url\",payload:{url}} opens a link. Labels are plain words, no emoji. When the person presses confirm, cancel or a button, their answers arrive as their next message, so end your turn after a widget that asks something. Keep it small: one confirm, one cancel, at most 8 rows. Never ask for passwords here. Not available in rooms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        widget: { type: "object", additionalProperties: true, description: "The widget tree." },
        fallback_text: { type: "string", description: "Optional plain-text version for clients that cannot draw widgets. Written for you when omitted." },
      },
      required: ["widget"],
    },
  },
  {
    name: "update_widget",
    description:
      "Replace a widget you showed earlier in this chat, in place: a progress bar moving, a status changing. `widget_id` is the id show_widget returned. A widget the person already answered cannot be updated; show a new one.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        widget_id: { type: "string" },
        widget: { type: "object", additionalProperties: true },
      },
      required: ["widget_id", "widget"],
    },
  },
];
