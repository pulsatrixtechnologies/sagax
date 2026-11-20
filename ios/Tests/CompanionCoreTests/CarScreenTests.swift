// The car's screen keeps to what CarPlay accepts (CarScreen). The fake car
// below holds CarPlay's rules as CarPlaySupport applies them: a pop with only
// the root on screen is refused, a present over a presented template is
// refused, a dismiss with nothing presented is refused, and past three
// templates the app is ended. CarPlaySceneDelegate gives every operation a
// completion block, but a refusal is still a step the car did not take: here
// it fails the test.
import XCTest
@testable import CompanionCore

final class CarScreenTests: XCTestCase {
    /// CarPlay's template stack for a voice-based conversation app.
    private final class FakeCar {
        enum Template: Equatable { case root, voice, ask }
        private(set) var templates: [Template] = [.root]
        private(set) var presented = false
        private(set) var refusals: [String] = []

        var stack: CarScreen.Stack {
            CarScreen.Stack(depth: templates.count, voiceShown: templates.contains(.voice), presented: presented)
        }

        func push(_ template: Template) {
            guard templates.count < CarScreen.maximumDepth else {
                refusals.append("Application exceeded the hierarchy depth limit")
                return
            }
            templates.append(template)
        }

        func popToRoot() {
            guard templates.count > 1 else {
                refusals.append("No templates were available to be popped.")
                return
            }
            templates = [.root]
        }

        func present() {
            guard !presented else {
                refusals.append("Presenting a template while a template is already presented is not supported.")
                return
            }
            presented = true
        }

        func dismiss() {
            guard presented else {
                refusals.append("No template was presented.")
                return
            }
            presented = false
        }

        /// The car's Back control: the top template closes, the app is not asked.
        func back() {
            if templates.count > 1 { templates.removeLast() }
        }
    }

    /// The call's screen as CarPlaySceneDelegate.follow drives it.
    private final class CallScreen {
        let car: FakeCar
        /// the app holds a voice screen for the running call
        var held = false

        init(car: FakeCar) { self.car = car }

        func follow(calling: Bool) {
            switch CarScreen.callStep(calling: calling, held: held, stack: car.stack) {
            case .none, .update:
                break
            case let .show(popToRootFirst):
                if popToRootFirst { car.popToRoot() }
                car.push(.voice)
                held = true
            case .close:
                held = false
                car.popToRoot()
            case .forget:
                held = false
            }
        }

        /// The bot whose call runs is opened again from the list.
        func reopen() {
            if !car.stack.voiceShown { held = false }
            follow(calling: true)
        }
    }

    func testOpeningAnotherBotAfterTheCarsBackNeverPopsAnEmptyStack() {
        let car = FakeCar()
        let screen = CallScreen(car: car)
        // bot A opened: its call shows the voice screen
        screen.follow(calling: true)
        XCTAssertEqual(car.templates, [.root, .voice])
        // the car's Back: the list again, the call goes on
        car.back()
        screen.follow(calling: true)
        XCTAssertEqual(car.templates, [.root], "the person's Back holds while the call runs")
        // bot B opened: A's call ends first, then B's starts
        screen.follow(calling: false)
        screen.follow(calling: true)
        XCTAssertEqual(car.refusals, [], "CarPlay refused a step (an exception without a completion block)")
        XCTAssertEqual(car.templates, [.root, .voice])
    }

    func testTheEndOfACallWithItsScreenOnTheStackGoesBackToTheList() {
        let car = FakeCar()
        let screen = CallScreen(car: car)
        screen.follow(calling: true)
        screen.follow(calling: true)
        screen.follow(calling: false)
        XCTAssertEqual(car.templates, [.root])
        XCTAssertFalse(screen.held)
        XCTAssertEqual(car.refusals, [])
    }

    func testReopeningTheBotOnTheCallShowsItsScreenAgain() {
        let car = FakeCar()
        let screen = CallScreen(car: car)
        screen.follow(calling: true)
        car.back()
        screen.reopen()
        XCTAssertEqual(car.templates, [.root, .voice])
        XCTAssertEqual(car.refusals, [])
    }

    func testTheVoiceScreenNeverGoesPastCarPlaysDepth() {
        let car = FakeCar()
        let screen = CallScreen(car: car)
        // an ask open, then another template over it: the stack is full
        car.push(.ask)
        car.push(.ask)
        XCTAssertFalse(CarScreen.canPush(car.stack))
        // a call starts from the phone or Siri
        screen.follow(calling: true)
        XCTAssertEqual(car.templates, [.root, .voice])
        XCTAssertEqual(car.refusals, [])
    }

    func testAPopToTheRootNeedsSomethingAboveIt() {
        XCTAssertFalse(CarScreen.canPopToRoot(CarScreen.Stack(depth: 1)))
        XCTAssertTrue(CarScreen.canPopToRoot(CarScreen.Stack(depth: 2)))
    }

    func testASecondAlertReplacesTheFirst() {
        let car = FakeCar()
        for _ in 0..<2 {
            switch CarScreen.alertStep(car.stack) {
            case .present:
                car.present()
            case .replace:
                car.dismiss()
                car.present()
            }
        }
        XCTAssertTrue(car.presented)
        XCTAssertEqual(car.refusals, [])
    }
}
