import SwiftUI

/// Rules for a typed dollar amount: digits and one separator, two decimals, no leading zeros.
enum AmountTyping {
    static let maxLength = 9

    /// What the field holds after the user typed `typed`, or `previous` when the edit breaks a rule.
    static func clean(_ typed: String, previous: String) -> String {
        // The decimal pad shows the locale's separator, which is a comma in many regions.
        let kept = String(typed.map { $0 == "," ? "." : $0 }.filter { $0 == "." || ("0"..."9").contains($0) })
        let parts = kept.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        guard let head = parts.first else { return "" }
        var whole = String(head.drop { $0 == "0" })
        if whole.isEmpty, !head.isEmpty || parts.count == 2 { whole = "0" }
        var text = whole
        if parts.count == 2 {
            let decimals = parts[1]
            if decimals.contains(".") || decimals.count > 2 { return previous }
            text += "." + decimals
        }
        return text.count <= maxLength ? text : previous
    }
}

/// The number pad that sits on the amount screens, so typing a price never brings up the system keyboard.
/// Each key sends the whole new text through `onType`, which applies `AmountTyping` and returns what it kept.
struct AmountKeypad: View {
    let text: String
    let onType: (String) -> String
    @State private var taps = 0

    private static let rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "delete"]]

    var body: some View {
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(Self.rows, id: \.self) { row in
                GridRow {
                    ForEach(row, id: \.self) { key in
                        Button { press(key) } label: { label(key) }
                            .buttonStyle(KeyStyle())
                            .accessibilityLabel(key == "delete" ? "Delete" : key)
                            .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                                if key == "delete" { clear() }
                            })
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: taps)
    }

    @ViewBuilder
    private func label(_ key: String) -> some View {
        if key == "delete" {
            Image(systemName: "delete.left").font(.system(size: 24, weight: .light))
        } else {
            Text(key).font(.system(size: 32, weight: .light))
        }
    }

    private func press(_ key: String) {
        let next = key == "delete" ? String(text.dropLast()) : text + key
        if onType(next) != text { taps += 1 }
    }

    private func clear() {
        guard !text.isEmpty else { return }
        _ = onType("")
        taps += 1
    }
}

private struct KeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Theme.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 62)
            .contentShape(Rectangle())
            .background {
                Circle()
                    .fill(Color.white.opacity(configuration.isPressed ? 0.08 : 0))
                    .frame(width: 64, height: 64)
            }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(duration: 0.18), value: configuration.isPressed)
    }
}
