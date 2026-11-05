import SwiftUI

struct AgentAvatar: View {
    let name: String
    var size: CGFloat = 64
    var revoked = false

    var body: some View {
        Text(String(name.prefix(1)))
            .font(.system(size: size * 0.42, weight: .semibold))
            .frame(width: size, height: size)
            .background(Theme.surfaceRaised, in: Circle())
            .overlay(alignment: .bottomTrailing) {
                if revoked {
                    Image(systemName: "xmark")
                        .font(.system(size: size * 0.16, weight: .heavy))
                        .foregroundStyle(.black)
                        .frame(width: size / 3, height: size / 3)
                        .background(.white, in: Circle())
                        .overlay(Circle().strokeBorder(Color(hex: 0x141414), lineWidth: 3))
                }
            }
            .accessibilityHidden(true)
    }
}

/// The grey uppercase label above a grouped card.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .medium))
            .tracking(0.7)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 2)
            .padding(.bottom, 8)
    }
}

/// One row of a grouped card with an optional hairline under it.
struct CardRow<Content: View>: View {
    var isLast = false
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 12) { content }
            .font(.system(size: 15))
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(minHeight: 52)
            .overlay(alignment: .bottom) {
                if !isLast { Rectangle().fill(Color(hex: 0x262626)).frame(height: 1) }
            }
    }
}

struct LimitStepper: View {
    let label: String
    @Binding var value: Int
    var minimum = AgentPolicy.step
    var isLast = false

    var body: some View {
        CardRow(isLast: isLast) {
            Text(label).foregroundStyle(Theme.textSecondary)
            Spacer()
            HStack(spacing: 14) {
                round("minus", label: "Less") { value = max(minimum, value - AgentPolicy.step) }
                    .disabled(value <= minimum)
                Text(Money.local(value, .ngn))
                    .font(.system(size: 17, weight: .medium).monospacedDigit())
                    .frame(minWidth: 96)
                    .contentTransition(.numericText())
                round("plus", label: "More") { value += AgentPolicy.step }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(label), \(Money.local(value, .ngn))")
    }

    private func round(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.snappy) { action() } }) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .frame(width: 32, height: 32)
                .background(Color(hex: 0x262626), in: Circle())
        }
        .foregroundStyle(Theme.textPrimary)
        .accessibilityLabel("\(label) \(self.label.lowercased())")
    }
}

struct CurrencyChips: View {
    @Binding var selection: Set<Currency>

    var body: some View {
        HStack(spacing: 6) {
            chip(.ngn, enabled: true)
            chip(.kes, enabled: false)
        }
    }

    private func chip(_ currency: Currency, enabled: Bool) -> some View {
        let on = selection.contains(currency)
        return Button {
            if on, selection.count > 1 { selection.remove(currency) } else { selection.insert(currency) }
        } label: {
            Text(currency.rawValue.uppercased() + (enabled ? "" : " soon"))
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .foregroundStyle(on ? .black : Theme.textSecondary)
                .background(on ? Color.white : Color(hex: 0x262626), in: Capsule())
        }
        .disabled(!enabled)
    }
}

struct SheetHeader: View {
    let title: String
    let onClose: () -> Void

    var body: some View {
        HStack {
            Spacer().frame(width: 32)
            Spacer()
            Text(title).font(.system(size: 17, weight: .semibold))
            Spacer()
            Button(action: onClose) { Image(systemName: "xmark") }
                .frame(width: 32, height: 32)
                .accessibilityLabel("Close")
        }
        .padding(.top, 20)
        .foregroundStyle(Theme.textPrimary)
    }
}
