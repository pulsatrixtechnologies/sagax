# Sagax in the car (Siri, CallKit, CarPlay)

What the phone app does in a car, within Apple's CarPlay rules (CarPlay
Developer Guide, October 2026), and what still waits for Apple.

## Without any CarPlay entitlement (every build)

| Feature | How | Where |
| --- | --- | --- |
| A call with a bot is a phone call | CallKit (`CallKitBridge`): the car shows it with mute and end, its audio goes to the car, the steering wheel button ends it | `ios/App/Call/CallKitBridge.swift` |
| The call names the bot | The CallKit handle is `sagax-bot:<id>` (`CarCallHandle`), the caller name is the bot's name: calling again from the call screen, the car or Siri reaches the same bot | `ios/Sources/CompanionCore/CarAssist.swift` |
| "Call Scout with Sagax" | `INStartCallIntent`, handled in the app's process (`application(_:handlerFor:)`), places the CallKit call even with the phone locked | `ios/App/CarAssist/SiriIntentHandlers.swift` |
| "Send a message to Scout with Sagax", a reply to an announced message | `INSendMessageIntent`: the reply goes back to the conversation the banner donated (`CommunicationNotification`), a new message to the bot Siri heard (`CarDirectory.route`) | same |
| Messages announced by Siri | Communication notifications already donate `INSendMessageIntent` with the bot as sender, which is what Announce Notifications reads | `ios/NotificationService/CommunicationNotification.swift` |
| Driving-safe call | When CarPlay is connected or the audio goes to a car (`CarRoute`), an approval is asked aloud and shorter, a learned skill waits until the person has stopped (a no is still heard), and nothing says to look at the screen (`DrivingSafety`) | `ios/App/Call/CallController.swift` |

Siri needs its permission: the app asks once, the first time the person
calls a bot (`SiriAccess.askOnce`). The Siri capability of the App ID is
turned on by automatic signing (`com.apple.developer.siri`); it is not a
request to Apple.

The main app includes `AppIntentVocabulary.plist` under
`ios/App/{Base,en,fr,pt-BR}.lproj/`. Each file supplies example phrases for
both `INSendMessageIntent` and `INStartCallIntent`. `en`, `fr` and `pt-BR`
are the app's supported catalog locales; Base supplies the development
language fallback. XcodeGen includes these localized resources through
the app's `App` source path, without adding them to an extension.
Apple requires examples for every supported intent and locale
([QA1950](https://developer.apple.com/library/archive/qa/qa1950/_index.html),
[Intent Phrases](https://developer.apple.com/documentation/sirikit/intent-phrases));
omitting them produces ITMS-90626 after a successful upload.
`node scripts/check-ios-app-intent-vocabulary.mjs` fails when a required
locale or intent example is missing from source (#1895). Clearing the
App Store Connect warnings still needs the next uploaded iOS binary.

Who a name is (`CarDirectory.resolve`): the same name first, then a name
that starts with what was said, then one that contains it; case, accents and
a leading article do not count. Two bots for one name make Siri ask which
one. Hidden bots and conversations with people are never reached.

## With the CarPlay entitlement (build flag)

Sagax fits Apple's **voice-based conversational** category
(`com.apple.developer.carplay-voice-based-conversation`, iOS 26.4): apps
that "enable conversations with voice assistants". One category per app.
The communication category (messaging and VoIP) is for conversations
between people and requires the three SiriKit messaging intents; it is not
the one for bots.

The CarPlay screen (`ios/App/CarAssist/CarPlaySceneDelegate.swift`):

1. the recent bots (a list: name and mascot, never a message), at most
   twelve;
2. choosing a bot calls it; CarPlay's voice screen shows the call
   (calling, listening, thinking, speaking, microphone off) with two action
   buttons, mute and hang up (iOS 26.4). A call started from Siri or the
   phone shows the same screen while it runs, as the category requires.

Depth two, Apple allows three. The audio session is the call's only (no
recording outside the voice screen). An approval is answered by voice or
waits; a call that cannot start shows its title, never "pick up the phone".

The code is in every build and never runs without the entitlement. The
build flag is a second XcodeGen spec:

```sh
cd ios && xcodegen generate --spec project-carplay.yml
```

It adds the entitlement, the CarPlay scene (`UIApplicationSceneManifest`)
and the `SAGAX_CARPLAY` Swift condition to `project.yml`. Use it only once
Apple has granted the entitlement and the App ID has the CarPlay
capability: signing without a CarPlay profile fails, so it cannot ship by
accident. Plain `xcodegen generate` stays the usual build.

## Testing

- `swift test --filter CarAssistTests`: names, replies, handles, the car's
  list, the driving rules, the voice screen states.
- CarPlay screen: CarPlay Simulator (Xcode 27 Device Hub, an iPhone on USB)
  or a car, with a build from `project-carplay.yml` and a CarPlay profile.
  The iOS Simulator's CarPlay window needs Simulator's I/O menu: there is no
  headless `simctl` path to it.
- Siri: on a device, "Call <bot> with Sagax", "Send a message to <bot> with
  Sagax", then a reply to an announced message (Settings > Notifications >
  Announce Notifications).

## Not done

- A bot calling the person (an incoming call) needs PushKit VoIP pushes
  from the server; the call is always placed from the phone today.
