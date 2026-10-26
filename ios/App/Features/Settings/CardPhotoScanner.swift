// 2026-10-21 (parité R10, ligne 84): "Photos de la carte" in Settings >
// Vault > New card. The person takes (or picks) one or two photos of their
// card; Vision reads the text ON THE PHONE and CardScanReading picks the
// number, the expiry and the name to fill the form. The photos are never
// uploaded, saved or shown to a bot, the text is never logged, and the
// security code is always typed by the person.
import CompanionCore
import PhotosUI
import UIKit
import SwiftUI
import Vision
import VisionKit

struct CardPhotoScanner: View {
    let onRead: (CardScanResult) -> Void
    @State private var picked: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var reading = false
    @State private var note: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if VNDocumentCameraViewController.isSupported {
                    Button { showCamera = true } label: { Label("Card photos", systemImage: "camera.viewfinder") }
                        .accessibilityIdentifier("vault-card-scan-camera")
                }
                PhotosPicker(selection: $picked, maxSelectionCount: 2, matching: .images) {
                    Label("From Photos", systemImage: "photo.on.rectangle")
                }
                .accessibilityIdentifier("vault-card-scan-photos")
                if reading {
                    ProgressView()
                    Text("Reading the card…").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.bordered)
            .disabled(reading)
            if let note {
                Text(note).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 10)
        .onValueChange(of: picked) { items in
            guard !items.isEmpty else { return }
            Task {
                var images: [UIImage] = []
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { images.append(image) }
                }
                picked = []
                await read(images)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CardCamera { images in
                showCamera = false
                Task { await read(images) }
            }
            .ignoresSafeArea()
        }
    }

    private func read(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        reading = true
        defer { reading = false }
        var result = CardScanResult()
        for image in images.prefix(2) {
            guard let cgImage = image.cgImage else { continue }
            let orientation = CGImagePropertyOrientation(image.imageOrientation)
            result = result.merged(with: CardScanReading.read(lines: await Self.lines(of: cgImage, orientation: orientation)))
        }
        if result.isEmpty {
            note = "No card was read. Try a sharper photo, or type it."
        } else {
            note = "Check what was read and type the security code yourself."
            onRead(result)
        }
    }

    /// The text lines of one photo, read on the device. `perform` is
    /// synchronous: the results are read after it, so nothing can answer
    /// twice (review of R10).
    private static func lines(of image: CGImage, orientation: CGImagePropertyOrientation) async -> [String] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = false
                let handler = VNImageRequestHandler(cgImage: image, orientation: orientation)
                guard (try? handler.perform([request])) != nil else { continuation.resume(returning: []); return }
                let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                continuation.resume(returning: lines)
            }
        }
    }
}

/// The system's document camera, for the front and the back of the card.
private struct CardCamera: UIViewControllerRepresentable {
    let done: ([UIImage]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let done: ([UIImage]) -> Void
        init(done: @escaping ([UIImage]) -> Void) { self.done = done }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            done((0..<min(scan.pageCount, 2)).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { done([]) }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { done([]) }
    }
}

private extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
