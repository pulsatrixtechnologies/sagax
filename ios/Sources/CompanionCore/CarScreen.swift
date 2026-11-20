// The car's screen (CarPlaySceneDelegate, docs/ios-carplay.md), step by step.
// CarPlay refuses a pop with nothing above the root, a present over a
// presented template and a dismiss with nothing presented, and a refusal
// without a completion block is an NSGenericException: the app quits
// ("An error was encountered during a template operation, but no completion
// block was specified"). It also ends a voice-based conversation or driving
// task app past three templates, the root included. Each step here is one the
// car accepts, read from the car's own stack.
import Foundation

public enum CarScreen {
    /// CarPlay's depth for a voice-based conversation or driving task app,
    /// the root included (CarPlaySupport's maximumClientHierarchyDepth).
    public static let maximumDepth = 3

    /// What the car's stack holds now (CPInterfaceController.templates and
    /// presentedTemplate).
    public struct Stack: Equatable, Sendable {
        /// templates on the stack, the root included
        public var depth: Int
        /// the call's voice screen is one of them
        public var voiceShown: Bool
        /// a template (an alert) is presented over the stack
        public var presented: Bool

        public init(depth: Int, voiceShown: Bool = false, presented: Bool = false) {
            self.depth = depth
            self.voiceShown = voiceShown
            self.presented = presented
        }
    }

    public enum CallStep: Equatable, Sendable {
        /// nothing to change
        case none
        /// push the voice screen, after a pop to the root when the stack is full
        case show(popToRootFirst: Bool)
        /// the voice screen is on the stack: show the call's state on it
        case update
        /// the call ended with its voice screen on the stack: back to the root
        case close
        /// the voice screen is no longer on the stack: forget it, pop nothing
        case forget
    }

    /// The call's screen. `calling`: a call runs and has a screen state;
    /// `held`: the app holds a voice screen for this call. The stack is the
    /// car's, never what the app remembers pushing: the car's Back control
    /// closes the voice screen without asking the app.
    public static func callStep(calling: Bool, held: Bool, stack: Stack) -> CallStep {
        guard calling else {
            if stack.voiceShown { return canPopToRoot(stack) ? .close : .forget }
            return held ? .forget : .none
        }
        if stack.voiceShown { return .update }
        // closed by the person during this call: it stays closed until the
        // bot is opened again from the list (CarPlaySceneDelegate.call)
        if held { return .none }
        return .show(popToRootFirst: !canPush(stack))
    }

    /// A pop to the root has something to pop.
    public static func canPopToRoot(_ stack: Stack) -> Bool { stack.depth > 1 }

    /// One more template stays within CarPlay's depth.
    public static func canPush(_ stack: Stack) -> Bool { stack.depth < maximumDepth }

    public enum AlertStep: Equatable, Sendable {
        case present
        /// an alert is already up: dismiss it, then present the new one
        case replace
    }

    public static func alertStep(_ stack: Stack) -> AlertStep { stack.presented ? .replace : .present }
}
