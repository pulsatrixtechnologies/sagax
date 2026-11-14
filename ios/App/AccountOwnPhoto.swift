// The person's own photo on an organization server (2026-10-16), in
// Settings > Account: Change Photo (the photo library or the camera), a
// square crop inside a circle (drag, pinch), then the 256 px square goes to
// the Sagax server (Session.setOwnPhoto, PUT /api/me/avatar), which writes
// it to Perspicax as this person. Remove Photo asks first. The photo store
// (AccountPhotoStore) keeps the new version at once; errors show under the
// rows. Shown only when the session says the profile is Perspicax's.
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

struct AccountOwnPhotoRows: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var libraryItem: PhotosPickerItem?
    @State private var showingLibrary = false
    @State private var showingCamera = false
    @State private var choosing = false
    @State private var cropping: CropSource?
    @State private var confirmingRemove = false
    @State private var working = false
    @State private var message: String?
    @State private var failed = false

    struct CropSource: Identifiable {
        let id = UUID()
        let image: UIImage
    }

    var body: some View {
        VStack(spacing: 0) {
            SettingsCard {
                SettingsRow(
                    title: "Change Photo",
                    systemImage: "camera",
                    accessory: working ? .progress : .none,
                    identifier: "account-photo-change"
                ) {
                    if !working { choosing = true }
                }
                if session.accountPhoto != nil {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: "Remove Photo", systemImage: "trash", style: .destructive, identifier: "account-photo-remove") {
                        if !working { confirmingRemove = true }
                    }
                }
            }
            if let message {
                Text(verbatim: message)
                    .font(Theme.Font.label)
                    .foregroundStyle(failed ? Theme.danger : Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .padding(.top, 6)
                    .accessibilityIdentifier("account-photo-message")
            }
        }
        .confirmationDialog("Change Photo", isPresented: $choosing, titleVisibility: .hidden) {
            Button("Choose from Library") { showingLibrary = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo") { showingCamera = true }
            }
            Button("Cancel", role: .cancel) {}
        }
        .photosPicker(isPresented: $showingLibrary, selection: $libraryItem, matching: .images)
        .onValueChange(of: libraryItem) { item in
            guard let item else { return }
            libraryItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    show(String(localized: "This image could not be read."), failed: true)
                    return
                }
                cropping = CropSource(image: image)
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraCapture { image in
                showingCamera = false
                if let image { cropping = CropSource(image: image) }
            }
            .ignoresSafeArea()
        }
        .sheet(item: $cropping) { source in
            OwnPhotoCropView(image: source.image) { cropped in
                cropping = nil
                guard let cropped else { return }
                Task { await upload(cropped) }
            }
        }
        .confirmationDialog("Remove your photo?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove Photo", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your initials will show instead, in Sagax and in Perspicax.")
        }
    }

    private func show(_ text: String?, failed: Bool) {
        message = text
        self.failed = failed
    }

    private func upload(_ image: UIImage) async {
        guard let encoded = OwnPhotoEncoding.encode(image) else {
            show(String(localized: "This image is too large."), failed: true)
            return
        }
        working = true
        show(String(localized: "Saving your photo…"), failed: false)
        let error = await session.setOwnPhoto(encoded.data, mime: encoded.mime)
        working = false
        show(error ?? String(localized: "Photo updated."), failed: error != nil)
    }

    private func remove() async {
        working = true
        show(String(localized: "Saving your photo…"), failed: false)
        let error = await session.removeOwnPhoto()
        working = false
        show(error ?? String(localized: "Photo removed."), failed: error != nil)
    }
}

/// The 256 px square the server keeps: a JPEG under 256 KiB.
enum OwnPhotoEncoding {
    static let side: CGFloat = 256

    /// Draw `image` (already square) at 256 x 256, one pixel per point.
    static func encode(_ image: UIImage) -> (data: Data, mime: String)? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let square = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }
        for quality in [0.9, 0.8, 0.7, 0.6] as [CGFloat] {
            if let data = square.jpegData(compressionQuality: quality), data.count <= CompanionClient.ownAvatarMaxBytes {
                return (data, "image/jpeg")
            }
        }
        return nil
    }

    /// The part of `image` under the circle: `scale` points per image pixel
    /// in a `viewport` square, moved by `offset`, as a square UIImage.
    static func crop(_ image: UIImage, viewport: CGFloat, scale: CGFloat, offset: CGSize) -> UIImage? {
        let upright = UIGraphicsImageRenderer(size: image.size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).image { _ in
            image.draw(at: .zero)
        }
        guard let cg = upright.cgImage, scale > 0 else { return nil }
        let side = viewport / scale
        let originX = (image.size.width - side) / 2 - offset.width / scale
        let originY = (image.size.height - side) / 2 - offset.height / scale
        let rect = CGRect(x: originX, y: originY, width: side, height: side).integral
            .intersection(CGRect(origin: .zero, size: image.size))
        guard !rect.isEmpty, let cropped = cg.cropping(to: rect) else { return nil }
        return UIImage(cgImage: cropped)
    }
}

/// A square stage with a circle; the photo covers it, drag to move, pinch
/// to zoom (1x to 3x). Use Photo hands back the square under the circle.
struct OwnPhotoCropView: View {
    @Environment(\.themePalette) var themePalette
    let image: UIImage
    let done: (UIImage?) -> Void
    @State private var zoom: CGFloat = 1
    @State private var pinch: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var dragStart: CGSize = .zero

    private let viewport: CGFloat = 280

    /// Points per image pixel at zoom 1: the shorter side fills the circle.
    private var cover: CGFloat { viewport / max(1, min(image.size.width, image.size.height)) }

    private func clamped(_ proposed: CGSize, zoom: CGFloat) -> CGSize {
        let scale = cover * zoom
        let maxX = max(0, (image.size.width * scale - viewport) / 2)
        let maxY = max(0, (image.size.height * scale - viewport) / 2)
        return CGSize(width: min(maxX, max(-maxX, proposed.width)), height: min(maxY, max(-maxY, proposed.height)))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Drag to place your face in the circle. The photo is saved in Pulsatrix Perspicax and shown everywhere you appear.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                let scale = cover * zoom * pinch
                ZStack {
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: image.size.width * scale, height: image.size.height * scale)
                        .offset(offset)
                    Rectangle()
                        .fill(Color.black.opacity(0.5))
                        .mask(
                            Rectangle().overlay(Circle().frame(width: viewport, height: viewport).blendMode(.destinationOut))
                                .compositingGroup()
                        )
                        .allowsHitTesting(false)
                    Circle().stroke(Color.white.opacity(0.8), lineWidth: 1).frame(width: viewport, height: viewport)
                        .allowsHitTesting(false)
                }
                .frame(width: viewport, height: viewport)
                .clipped()
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            offset = clamped(CGSize(width: dragStart.width + value.translation.width, height: dragStart.height + value.translation.height), zoom: zoom * pinch)
                        }
                        .onEnded { _ in dragStart = offset }
                        .simultaneously(with: MagnificationGesture()
                            .onChanged { pinch = min(3 / zoom, max(1 / zoom, $0)) }
                            .onEnded { _ in
                                zoom = min(3, max(1, zoom * pinch))
                                pinch = 1
                                offset = clamped(offset, zoom: zoom)
                                dragStart = offset
                            })
                )
                .accessibilityIdentifier("account-photo-crop")
                Slider(value: Binding(get: { zoom }, set: { zoom = $0; offset = clamped(offset, zoom: $0); dragStart = offset }), in: 1...3) {
                    Text("Zoom")
                }
                .padding(.horizontal, 32)
                Spacer()
            }
            .padding(.top, 16)
            .navigationTitle(Text("Crop your photo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { done(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use This Photo") {
                        done(OwnPhotoEncoding.crop(image, viewport: viewport, scale: cover * zoom, offset: offset))
                    }
                    .accessibilityIdentifier("account-photo-apply")
                }
            }
        }
    }
}

/// The system camera.
struct CameraCapture: UIViewControllerRepresentable {
    /// The front camera first (a portrait); false for the back one.
    var front = true
    let done: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        if front, UIImagePickerController.isCameraDeviceAvailable(.front) { picker.cameraDevice = .front }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            done(nil)
        }
    }
}
