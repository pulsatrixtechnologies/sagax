; Sagax's additions to electron-builder's NSIS installer (electron-builder.yml
; nsis.include). Kept small on purpose: the shortcut logic itself stays
; electron-builder's (an update passes --keep-shortcuts to the old
; uninstaller, so the .lnk files and taskbar pins are kept, never recreated).
;
; Why this exists (2026-10-19): an update moves the old install folder away
; before the new files land. While it is gone, Explorer draws every shortcut
; and taskbar pin that points at Sagax.exe with a blank icon, and it may keep
; that blank icon cached after the new Sagax.exe is back. Telling the shell
; the icons changed once the files are in makes it draw them again.

!macro customInstall
  ; SHCNE_UPDATEITEM (0x2000) on the executable and each shortcut,
  ; SHCNF_PATHW (0x5) | SHCNF_FLUSH (0x1000): redraw these icons now.
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$appExe", p 0)'
  ${if} ${FileExists} "$newDesktopLink"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newDesktopLink", p 0)'
  ${endIf}
  ${if} ${FileExists} "$newStartMenuLink"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newStartMenuLink", p 0)'
  ${endIf}
  ; SHCNE_ASSOCCHANGED (0x08000000) | SHCNF_FLUSH: the shell drops its icon
  ; cache for the taskbar pins too (pinned .lnk files live in the user's
  ; roaming profile, outside the install).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
