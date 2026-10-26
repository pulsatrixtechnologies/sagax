import LocalAuthentication

/// Face ID or Touch ID before a saved secret is shown. A failure shows
/// nothing. The passcode is not a substitute: the decision is biometric.
enum VaultRevealGate {
    static func confirm(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return false }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, _ in
                continuation.resume(returning: ok)
            }
        }
    }
}
