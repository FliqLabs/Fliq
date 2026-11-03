import PhotosUI
import SwiftUI

struct ProfileSetupView: View {
    @Bindable var flow: OnboardingFlow
    let onContinue: () -> Void
    @State private var pick: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                if let name = flow.name, flow.canClaim {
                    Label("\(name.account) is yours", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.confirmed)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                        .background(Theme.confirmed.opacity(0.14), in: Capsule())
                        .padding(.bottom, 14)
                }
                Text("Add a face to it")
                    .font(.system(size: 26, weight: .bold))
                Text("People you pay see this next to your name")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 36)

            PhotosPicker(selection: $pick, matching: .images) { [photo = flow.photo] in Avatar(photo: photo) }
                .padding(.top, 40)
                .accessibilityLabel("Choose photo")

            card
                .padding(.top, 36)

            Spacer()

            HStack {
                Text("Photo stays on your device")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Button(action: onContinue) {
                    ChipLabel(text: "Continue", symbol: "chevron.right", color: Theme.confirmed)
                }
            }
            .padding(.bottom, 14)
        }
        .fliqScreen(aurora: Aurora(accent: Theme.confirmed))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Skip", action: onContinue).fontWeight(.semibold)
            }
        }
        .onChange(of: pick) {
            Task { flow.photo = try? await pick?.loadTransferable(type: Data.self) }
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            field("Name") {
                TextField("Your name", text: $flow.displayName)
                    .textContentType(.givenName)
                    .fontWeight(.semibold)
            }
            field("What you do") {
                TextField("Optional", text: $flow.bio)
            }
            field("Vault", isLast: true) {
                Text(flow.canClaim ? flow.name?.account ?? "" : "Assigned when you claim a name")
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(flow.canClaim ? Theme.textPrimary : Theme.textTertiary)
            }
        }
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.08)))
    }

    private func field<Content: View>(_ label: String, isLast: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 90, alignment: .leading)
            content().font(.system(size: 15))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1) }
        }
    }
}

private struct Avatar: View {
    let photo: Data?

    var body: some View {
        Group {
            if let photo, let image = UIImage(data: photo) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.surfaceRaised)
            }
        }
        .frame(width: 128, height: 128)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 2))
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: "camera.fill")
                .font(.system(size: 15))
                .foregroundStyle(.black)
                .frame(width: 36, height: 36)
                .background(.white, in: Circle())
                .overlay(Circle().strokeBorder(Color(hex: 0x0A0A0A), lineWidth: 3))
        }
        .background {
            Circle().fill(Theme.confirmed).opacity(0.18).blur(radius: 30).padding(-16)
        }
    }
}
