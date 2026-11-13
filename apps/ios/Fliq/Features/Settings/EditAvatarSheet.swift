import PhotosUI
import SwiftUI

/// Tapping your photo in Settings: your avatar as others see it, your initial as the alternative, your fliq name,
/// and one button to add or change the photo. The bin removes the photo and goes back to the initial.
struct EditAvatarSheet: View {
    @Binding var user: User?
    let name: String
    let handle: String?
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var pick: PhotosPickerItem?
    @State private var isWorking = false
    @State private var failed = false

    private var photoURL: URL? { user?.photoUrl.flatMap(URL.init(string:)) }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text("Edit avatar").font(.system(size: 18, weight: .medium))
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Icon("xmark", size: 18)
                            .foregroundStyle(Theme.textPrimary)
                            .frame(width: 44, height: 44)
                            .fliqGlass(Circle(), interactive: true)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .padding(.top, 20)

            HStack(spacing: 18) {
                PersonAvatar(name: name, photoURL: photoURL, size: 120)
                    .overlay {
                        if isWorking {
                            Circle().fill(.black.opacity(0.5))
                            ProgressView().tint(.white)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        if photoURL != nil {
                            Button { Task { await remove() } } label: {
                                Icon("trash", size: 16)
                                    .foregroundStyle(Theme.textPrimary)
                                    .frame(width: 36, height: 36)
                                    .background(Theme.surfaceRaised, in: Circle())
                                    .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                            }
                            .accessibilityLabel("Remove photo")
                            .offset(x: 4, y: -4)
                        }
                    }
                if photoURL != nil {
                    Button { Task { await remove() } } label: {
                        PersonAvatar(name: name, size: 56).opacity(0.85)
                    }
                    .accessibilityLabel("Use your initial instead")
                }
            }
            .animation(.smooth(duration: 0.3), value: photoURL)
            .padding(.top, 36)

            if let handle {
                Text(handle)
                    .font(.system(size: 17, weight: .medium))
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .overlay(Capsule().strokeBorder(Theme.hairline))
                    .padding(.top, 20)
            }
            if failed {
                Text("That didn't save. Try again.").font(.system(size: 14)).foregroundStyle(Theme.warning).padding(.top, 12)
            }
            Spacer(minLength: 24)

            PhotosPicker(selection: $pick, matching: .images) {
                HStack(spacing: 10) {
                    Icon("photo", size: 20)
                    Text(photoURL == nil ? "Add photo" : "Change photo")
                }
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(Color.black, in: Capsule())
            }
            .disabled(environment.photos == nil || isWorking)
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .onChange(of: pick) { _, item in
            guard let item else { return }
            Task { await save(item) }
        }
    }

    /// Shrinks the picked photo, puts it on Cloudinary, then records the URL with `PATCH /me`.
    private func save(_ item: PhotosPickerItem) async {
        defer { pick = nil }
        guard let photos = environment.photos else { return }
        await working {
            guard
                let raw = try? await item.loadTransferable(type: Data.self),
                let jpeg = ProfilePhoto.prepare(raw),
                let url = try? await photos.upload(jpeg)
            else { throw CancellationError() }
            user = try await environment.api.updateProfilePhoto(url)
        }
    }

    private func remove() async {
        await working { user = try await environment.api.removeProfilePhoto() }
    }

    private func working(_ body: () async throws -> Void) async {
        isWorking = true
        failed = false
        defer { isWorking = false }
        do { try await body() } catch { failed = true }
    }
}
