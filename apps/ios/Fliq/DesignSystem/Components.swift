import SwiftUI

/// The 54pt outlined button from App v5. `filled` is the white final action (Confirm).
struct PrimaryButtonStyle: ButtonStyle {
    var filled = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(foreground)
            .background(filled && isEnabled ? Color.white : .clear, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                if !filled || !isEnabled {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(isEnabled ? Color.white.opacity(0.55) : Color(hex: 0x333333))
                }
            }
            .opacity(configuration.isPressed ? 0.7 : 1)
    }

    private var foreground: Color {
        guard isEnabled else { return Theme.textDisabled }
        return filled ? .black : Theme.textPrimary
    }
}

/// The big light numeral with its smaller currency symbol, used on every money screen.
struct HeroAmount: View {
    let symbol: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(symbol)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(Theme.hero())
                .tracking(-1.9)
                .foregroundStyle(Theme.textPrimary)
                .contentTransition(.numericText())
        }
        .accessibilityElement(children: .combine)
    }
}

/// The grouped card of label and value rows (Quote, Paid, Details).
struct DetailCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct DetailRow<Value: View>: View {
    let label: String
    var isLast = false
    @ViewBuilder let value: Value

    var body: some View {
        HStack {
            Text(label).foregroundStyle(Theme.textSecondary)
            Spacer()
            value.fontWeight(.medium).monospacedDigit()
        }
        .font(.system(size: 15))
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
        .overlay(alignment: .bottom) {
            if !isLast { Rectangle().fill(Color(hex: 0x262626)).frame(height: 1) }
        }
    }
}

extension DetailRow where Value == Text {
    init(_ label: String, _ value: String, isLast: Bool = false) {
        self.label = label
        self.isLast = isLast
        self.value = Text(value)
    }
}

extension View {
    /// The dark gradient ground every pushed screen uses, with the brand aurora on top when given.
    func fliqScreen(_ title: String = "", ground: LinearGradient = Theme.ground, aurora: Aurora? = nil) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 16)
            .background {
                ZStack(alignment: .top) {
                    ground
                    aurora
                }
                .ignoresSafeArea()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
    }
}
