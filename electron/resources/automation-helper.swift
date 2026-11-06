// Sagax automation helper: reads, or asks for, the macOS Automation grant
// (Apple Events) from Sagax to one Apple app. It runs as a child of Sagax, so
// TCC attributes the request to Sagax (the responsible process) and the
// prompt names Sagax. It never sends a real command to the target app.
//
//   automation-helper status <bundle-id>   -> granted | denied | notAsked | notRunning | unknown:<code>
//   automation-helper ask <bundle-id>      -> same, after macOS showed its prompt if needed
import AppKit
import CoreServices
import Foundation

func state(_ bundleId: String, ask: Bool) -> String {
  let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
  guard let desc = target.aeDesc else { return "unknown:nodesc" }
  // typeWildCard for class and id: "may Sagax send this app any event".
  let status = AEDeterminePermissionToAutomateTarget(desc, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
  switch status {
  case noErr: return "granted"
  case OSStatus(errAEEventNotPermitted): return "denied"
  case OSStatus(errAEEventWouldRequireUserConsent): return "notAsked"
  case OSStatus(procNotFound): return "notRunning"
  default: return "unknown:\(status)"
  }
}

/// macOS only answers for a running app. Asking launches the app hidden and
/// in the background (no focus change), then waits for it to come up.
func launchHidden(_ bundleId: String) -> Bool {
  if !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty { return true }
  guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return false }
  let config = NSWorkspace.OpenConfiguration()
  config.activates = false
  config.hides = true
  config.addsToRecentItems = false
  NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
  let deadline = Date().addingTimeInterval(15)
  while Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    if !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).isEmpty { return true }
  }
  return false
}

let args = CommandLine.arguments
guard args.count == 3, ["status", "ask"].contains(args[1]), !args[2].isEmpty, args[2].count <= 200 else {
  FileHandle.standardError.write("usage: automation-helper status|ask <bundle-id>\n".data(using: .utf8)!)
  exit(2)
}
let bundleId = args[2]
let ask = args[1] == "ask"
var answer = state(bundleId, ask: ask)
if ask && answer == "notRunning" && launchHidden(bundleId) {
  // A freshly launched app may need a moment before it accepts events.
  for _ in 0..<20 {
    answer = state(bundleId, ask: true)
    if answer != "notRunning" { break }
    RunLoop.current.run(until: Date().addingTimeInterval(0.25))
  }
}
print(answer)
