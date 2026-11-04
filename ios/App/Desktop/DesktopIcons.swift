// iPad I2: the desktop's own icons (lucide-react, ISC licence, the icon set
// the renderer draws), so the sidebar's glyphs match point for point instead
// of falling back to SF Symbols of another weight and shape. Each icon is its
// lucide node list (24 x 24 viewBox, stroke-width 2, round caps and joins),
// with `rect` and `circle` written as path data, drawn through CompanionCore's
// SVG path parser.
import SwiftUI
import CompanionCore

enum DesktopIcon: String, CaseIterable {
    case plus, panelLeftClose, panelLeftOpen, search, chevronRight, network, calendarDays, puzzle, library
    case ellipsis, pin, pinOff, folderPlus, folderInput, bellDot, pencil, clipboardCopy, eyeOff, trash
    case users, share, smartphone, settings, keyboard, info, help, squarePen, star, arrowLeftRight, arrowUp, arrowDown, eye
    // the bot panel (I4b)
    case panelRight, squareTerminal, activity, calendarClock, fileText
    // the sidebar footer's gamertag (I2b)
    case trophy, tabletSmartphone, archive, x, command, check
    // the sidebar foot's Capabilities button (SidebarFoot.tsx AppsGridIcon), the composer's Model row
    case appsGrid, brain
    // the account menu of 2026-10-28 (Usage ›, Help ›, Tools ›)
    case gauge, bookOpen, wrench
    // the compose picker's wizard row (WandSparkles)
    case wand
    // the palette's bot rows (lucide Bot)
    case bot
    // Automations header (List, Filters), the grouped list's folders, the bot panel's Suggestions
    case list, slidersHorizontal, folder, sparkles, refresh
    // Team map (Monitor, Minus) and About's link rows (ExternalLink)
    case monitor, minus, externalLink, messageCircle
    // lot 6: the multi-select bar (CheckCheck, ListChecks) and the computer window (Minimize2, Hand)
    case checkCheck, listChecks, minimize, hand
    // sweep: the rail's expand (ChevronsRight), the palette's message hits
    // (MessageSquare), Put on the desktop (PictureInPicture2)
    case chevronsRight, messageSquare, pictureInPicture
    // the pages sweep (2026-11-03): Automations' header (Menu, ChevronLeft,
    // Clock3, Pause, CircleAlert), Memory's tabs and lists (Tag, CircleCheck,
    // NotebookText), the map's settings (Settings2), fit and play
    case messageSquare, messagesSquare, clipboardList, user, menu, chevronLeft, clock3, pause, circleAlert, tag, circleCheck, notebookText, settings2, maximize2, play

    /// Path data in the 24 pt viewBox.
    var paths: [String] {
        switch self {
        case .plus: ["M5 12h14", "M12 5v14"]
        case .messageSquare: ["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"]
        case .messagesSquare: ["M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z", "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"]
        case .clipboardList: [Self.rect(8, 2, 8, 4, 1), "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M12 11h4", "M12 16h4", "M8 11h.01", "M8 16h.01"]
        case .user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", Self.circle(12, 7, 4)]
        case .menu: ["M4 5h16", "M4 12h16", "M4 19h16"]
        case .chevronLeft: ["m15 18-6-6 6-6"]
        case .clock3: [Self.circle(12, 12, 10), "M12 6v6h4"]
        case .pause: [Self.rect(14, 3, 5, 18, 1), Self.rect(5, 3, 5, 18, 1)]
        case .circleAlert: [Self.circle(12, 12, 10), "M12 8L12 12", "M12 16L12.01 16"]
        case .tag: ["M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z", Self.circle(7.5, 7.5, 0.5)]
        case .circleCheck: [Self.circle(12, 12, 10), "m16 9-5.5 5.5L8 12"]
        case .notebookText: ["M2 6h4", "M2 10h4", "M2 14h4", "M2 18h4", Self.rect(4, 2, 16, 20, 2), "M9.5 8h5", "M9.5 12H16", "M9.5 16H14"]
        case .settings2: ["M14 17H5", "M19 7h-9", Self.circle(17, 17, 3), Self.circle(7, 7, 3)]
        case .maximize2: ["M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6"]
        case .play: ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"]
        case .monitor: [Self.rect(2, 3, 20, 14, 2), "M8 21h8", "M12 17v4"]
        case .minus: ["M5 12h14"]
        case .messageCircle: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"]
        case .externalLink: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]
        case .panelLeftClose: [Self.rect(3, 3, 18, 18, 2), "M9 3v18", "m16 15-3-3 3-3"]
        case .panelLeftOpen: [Self.rect(3, 3, 18, 18, 2), "M9 3v18", "m14 9 3 3-3 3"]
        case .search: ["m21 21-4.34-4.34", Self.circle(11, 11, 8)]
        case .chevronRight: ["m9 18 6-6-6-6"]
        case .network:
            [Self.rect(16, 16, 6, 6, 1), Self.rect(2, 16, 6, 6, 1), Self.rect(9, 2, 6, 6, 1),
             "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"]
        case .calendarDays:
            ["M8 2v4", "M16 2v4", Self.rect(3, 4, 18, 18, 2), "M3 10h18",
             "M8 14h.01", "M12 14h.01", "M16 14h.01", "M8 18h.01", "M12 18h.01", "M16 18h.01"]
        case .puzzle:
            ["M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"]
        case .library: ["m16 6 4 14", "M12 6v14", "M8 8v12", "M4 4v16"]
        case .ellipsis: [Self.circle(12, 12, 1), Self.circle(19, 12, 1), Self.circle(5, 12, 1)]
        case .pin:
            ["M12 17v5",
             "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"]
        case .pinOff:
            ["M12 17v5", "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89", "m2 2 20 20",
             "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"]
        case .folderPlus:
            ["M12 10v6", "M9 13h6",
             "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.930 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"]
        case .folderInput:
            ["M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",
             "M2 13h10", "m9 16 3-3-3-3"]
        case .bellDot:
            ["M10.268 21a2 2 0 0 0 3.464 0",
             "M13.916 2.314A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.74 7.327A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673 9 9 0 0 1-.585-.665",
             Self.circle(18, 8, 3)]
        case .pencil:
            ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
             "m15 5 4 4"]
        case .clipboardCopy:
            [Self.rect(8, 2, 8, 4, 1), "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
             "M16 4h2a2 2 0 0 1 2 2v4", "M21 14H11", "m15 10-4 4 4 4"]
        case .eyeOff:
            ["M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
             "M14.084 14.158a3 3 0 0 1-4.242-4.242",
             "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
             "m2 2 20 20"]
        case .trash:
            ["M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]
        case .users:
            ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M16 3.128a4 4 0 0 1 0 7.744",
             "M22 21v-2a4 4 0 0 0-3-3.87", Self.circle(9, 7, 4)]
        case .share:
            [Self.circle(18, 5, 3), Self.circle(6, 12, 3), Self.circle(18, 19, 3),
             "M8.59 13.51 15.42 17.49", "M15.41 6.51 8.59 10.49"]
        case .smartphone: [Self.rect(5, 2, 14, 20, 2), "M12 18h.01"]
        case .settings:
            ["M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
             Self.circle(12, 12, 3)]
        case .keyboard:
            ["M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01",
             Self.rect(2, 4, 20, 16, 2)]
        case .info: [Self.circle(12, 12, 10), "M12 16v-4", "M12 8h.01"]
        case .help: [Self.circle(12, 12, 10), "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"]
        case .squarePen:
            ["M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
             "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"]
        case .star:
            ["M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"]
        case .arrowLeftRight: ["M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4"]
        case .arrowUp: ["m5 12 7-7 7 7", "M12 19V5"]
        case .arrowDown: ["M12 5v14", "m19 12-7 7-7-7"]
        case .panelRight: [Self.rect(3, 3, 18, 18, 2), "M15 3v18"]
        case .x: ["M18 6 6 18", "m6 6 12 12"]
        case .command: ["M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"]
        case .check: ["M20 6 9 17l-5-5"]
        case .bot: ["M12 8V4H8", Self.rect(4, 8, 16, 12, 2), "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"]
        case .wand: [
            "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",
            "m14 7 3 3", "M5 6v4", "M19 14v4", "M10 2v2", "M7 8H3", "M21 16h-4", "M11 3H9",
        ]
        case .gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"]
        case .bookOpen: ["M12 7v14", "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"]
        case .wrench: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"]
        case .appsGrid: [Self.rect(3, 3, 7, 7, 1.5), Self.rect(14, 3, 7, 7, 1.5), Self.rect(3, 14, 7, 7, 1.5), "M17.5 14v7", "M14 17.5h7"]
        case .brain: [
            "M12 18V5", "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
            "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5", "M17.997 5.125a4 4 0 0 1 2.526 5.77",
            "M18 18a4 4 0 0 0 2-7.464", "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
            "M6 18a4 4 0 0 1-2-7.464", "M6.003 5.125a4 4 0 0 0-2.526 5.77",
        ]
        case .archive: [Self.rect(2, 3, 20, 5, 1), "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", "M10 12h4"]
        case .tabletSmartphone: [Self.rect(3, 8, 10, 14, 2), "M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4", "M8 18h.01"]
        case .trophy: [
            "M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978",
            "M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978",
            "M18 9h1.5a1 1 0 0 0 0-5H18", "M4 22h16",
            "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z",
            "M6 9H4.5a1 1 0 0 1 0-5H6",
        ]
        case .squareTerminal: ["m7 11 2-2-2-2", "M11 13h4", Self.rect(3, 3, 18, 18, 2)]
        case .activity:
            ["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a0.25 0.25 0 0 1-0.48 0L9.24 2.18a0.25 0.25 0 0 0-0.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"]
        case .calendarClock:
            ["M16 14v2.2l1.6 1", "M16 2v4", "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", "M3 10h5", "M8 2v4", Self.circle(16, 16, 6)]
        case .fileText:
            ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"]
        case .list: ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"]
        case .slidersHorizontal:
            ["M10 5H3", "M12 19H3", "M14 3v4", "M16 17v4", "M21 12h-9", "M21 19h-5", "M21 5h-7", "M8 10v4", "M8 12H3"]
        case .refresh:
            ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"]
        case .folder: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"]
        case .sparkles:
            ["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
             "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3"]
        case .checkCheck: ["M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16"]
        case .listChecks: ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"]
        case .minimize: ["m14 10 7-7", "M20 10h-6V4", "m3 21 7-7", "M4 14h6v6"]
        case .hand:
            ["M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8",
             "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"]
        case .chevronsRight: ["m6 17 5-5-5-5", "m13 17 5-5-5-5"]
        case .messageSquare: ["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"]
        case .pictureInPicture: ["M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4", Self.rect(12, 13, 10, 7, 2)]
        case .eye:
            ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
             Self.circle(12, 12, 3)]
        }
    }

    /// The SF Symbol for the same entry in a system menu (a long press or a
    /// right click draws iPadOS's context menu, which takes only symbols).
    var symbol: String {
        switch self {
        case .plus: "plus"
        case .panelLeftClose: "sidebar.left"
        case .panelLeftOpen: "sidebar.left"
        case .search: "magnifyingglass"
        case .monitor: "display"
        case .minus: "minus"
        case .messageCircle: "bubble.left"
        case .externalLink: "arrow.up.right.square"
        case .chevronRight: "chevron.right"
        case .network: "point.3.connected.trianglepath.dotted"
        case .calendarDays: "calendar"
        case .puzzle: "puzzlepiece.extension"
        case .library: "books.vertical"
        case .ellipsis: "ellipsis"
        case .pin: "pin"
        case .pinOff: "pin.slash"
        case .folderPlus: "folder.badge.plus"
        case .folderInput: "folder"
        case .bellDot: "bell.badge"
        case .pencil: "pencil"
        case .clipboardCopy: "doc.on.clipboard"
        case .eyeOff: "eye.slash"
        case .eye: "eye"
        case .panelRight: "sidebar.right"
        case .trophy: "trophy"
        case .tabletSmartphone: "ipad.and.iphone"
        case .archive: "archivebox"
        case .x: "xmark"
        case .command: "command"
        case .check: "checkmark"
        case .appsGrid: "square.grid.2x2"
        case .bot: "cpu"
        case .wand: "wand.and.stars"
        case .gauge: "gauge.with.dots.needle.33percent"
        case .bookOpen: "book"
        case .wrench: "wrench.adjustable"
        case .brain: "brain"
        case .squareTerminal: "terminal"
        case .activity: "waveform.path.ecg"
        case .calendarClock: "calendar.badge.clock"
        case .fileText: "doc.text"
        case .trash: "trash"
        case .users: "person.2"
        case .share: "square.and.arrow.up"
        case .smartphone: "iphone"
        case .settings: "gearshape"
        case .keyboard: "keyboard"
        case .info: "info.circle"
        case .help: "questionmark.circle"
        case .squarePen: "square.and.pencil"
        case .star: "star"
        case .arrowLeftRight: "arrow.left.arrow.right"
        case .arrowUp: "arrow.up"
        case .arrowDown: "arrow.down"
        case .list: "list.bullet"
        case .slidersHorizontal: "slider.horizontal.3"
        case .folder: "folder"
        case .sparkles: "sparkles"
        case .refresh: "arrow.clockwise"
        case .checkCheck: "checkmark.circle"
        case .listChecks: "checklist"
        case .minimize: "arrow.down.right.and.arrow.up.left"
        case .hand: "hand.raised"
        case .chevronsRight: "chevron.right.2"
        case .messageSquare: "message"
        case .pictureInPicture: "pip"
        case .messageSquare: "message"
        case .messagesSquare: "bubble.left.and.bubble.right"
        case .clipboardList: "list.clipboard"
        case .user: "person"
        case .menu: "line.3.horizontal"
        case .chevronLeft: "chevron.left"
        case .clock3: "clock"
        case .pause: "pause"
        case .circleAlert: "exclamationmark.circle"
        case .tag: "tag"
        case .circleCheck: "checkmark.circle"
        case .notebookText: "book.closed"
        case .settings2: "slider.horizontal.2.square"
        case .maximize2: "arrow.up.left.and.arrow.down.right"
        case .play: "play"
        }
    }

    /// `<rect x y width height rx>` as path data.
    private static func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) -> String {
        "M\(x + r) \(y)H\(x + w - r)A\(r) \(r) 0 0 1 \(x + w) \(y + r)V\(y + h - r)A\(r) \(r) 0 0 1 \(x + w - r) \(y + h)"
            + "H\(x + r)A\(r) \(r) 0 0 1 \(x) \(y + h - r)V\(y + r)A\(r) \(r) 0 0 1 \(x + r) \(y)Z"
    }

    /// `<circle cx cy r>` as path data.
    private static func circle(_ cx: Double, _ cy: Double, _ r: Double) -> String {
        "M\(cx - r) \(cy)A\(r) \(r) 0 1 0 \(cx + r) \(cy)A\(r) \(r) 0 1 0 \(cx - r) \(cy)Z"
    }
}

/// One lucide icon at `size` points. `strokeWidth` is in viewBox units, as
/// the renderer's `strokeWidth` prop (2 by default, 1.75 in the sidebar head).
struct DesktopIconView: View {
    let icon: DesktopIcon
    var size: CGFloat = 16
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
