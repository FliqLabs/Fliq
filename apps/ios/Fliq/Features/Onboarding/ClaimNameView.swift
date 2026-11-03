import SwiftUI

struct ClaimNameView: View {
    @Bindable var flow: OnboardingFlow
    let onContinue: () -> Void
    let onSkip: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Text("Claim your name")
                    .font(.system(size: 26, weight: .bold))
                    .tracking(-0.52)
                Text("Pay and get paid by it, anywhere on fliq")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 36)

            nameCapsule
                .padding(.top, 34)

            Text(hint)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 16)

            if !flow.suggestions.isEmpty {
                HStack(spacing: 8) {
                    ForEach(flow.suggestions, id: \.self) { suggestion in
                        Button(suggestion) { flow.pick(suggestion) }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(Color.white.opacity(0.08), in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.1)))
                    }
                }
                .padding(.top, 18)
            }

            Spacer()

            HStack {
                statusChip
                Spacer()
                Button(action: onContinue) {
                    ChipLabel(text: "Continue", symbol: "chevron.right", color: flow.canClaim ? Theme.confirmed : Theme.textTertiary)
                }
                .disabled(!flow.canClaim)
            }
            .padding(.bottom, 14)
        }
        .fliqScreen(ground: Theme.onboardingGround, aurora: Aurora(accent: accent))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Skip", action: onSkip).fontWeight(.semibold)
            }
        }
        .onAppear { focused = true }
    }

    private var nameCapsule: some View {
        HStack(spacing: 0) {
            Text(flow.nameText.isEmpty ? "yourname" : flow.nameText)
                .tracking(-0.26)
                .hidden()
                .overlay(alignment: .leading) {
                    TextField("yourname", text: $flow.nameText)
                        .font(.system(size: 26, weight: .bold))
                        .tracking(-0.26)
                        .focused($focused)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .submitLabel(.done)
                        .onSubmit { if flow.canClaim { onContinue() } }
                        .accessibilityLabel("Name")
                        .accessibilityHint("Ends in \(FliqName.suffix)")
                }
                .padding(.trailing, 6)
            Text(FliqName.suffix)
                .foregroundStyle(Theme.textPrimary.opacity(0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .layoutPriority(-1)
        }
        .font(.system(size: 26, weight: .bold))
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(Color.white.opacity(0.06), in: Capsule())
        .overlay(TravellingBorder(tint: tint))
        .background {
            Capsule()
                .fill(tint)
                .opacity(0.22)
                .blur(radius: 46)
                .padding(-14)
        }
        .animation(.easeInOut(duration: 0.25), value: flow.status)
    }

    @ViewBuilder
    private var statusChip: some View {
        switch flow.status {
        case .empty, .invalid:
            EmptyView()
        case .checking:
            ChipLabel(text: "Checking…", symbol: "hourglass", color: Theme.textMuted)
        case .available:
            ChipLabel(text: "Available", symbol: "checkmark.circle.fill", color: Theme.confirmed, badge: true)
        case .taken:
            ChipLabel(text: "Taken", symbol: "xmark.circle.fill", color: Theme.danger, badge: true)
        case .unreachable:
            ChipLabel(text: "Can't check right now", symbol: "wifi.exclamationmark", color: Theme.warning)
        }
    }

    private var hint: String {
        switch flow.status {
        case .invalid, .taken: "Letters, digits and hyphens, up to \(FliqName.maxLength)"
        case .checking: " "
        default: "Free · yours for life · one tap to claim"
        }
    }

    private var tint: Color {
        accent ?? Color.white.opacity(0.35)
    }

    private var accent: Color? {
        switch flow.status {
        case .available: Theme.confirmed
        case .taken, .invalid: Theme.danger
        default: nil
        }
    }
}
