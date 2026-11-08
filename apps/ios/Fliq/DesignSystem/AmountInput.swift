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

/// An amount shown in the screen's own style and typed on the system decimal pad. The field itself is hidden;
/// tapping the amount brings the keyboard back.
struct AmountInput<Content: View>: View {
    let text: String
    let onType: (String) -> String
    var isFocused: FocusState<Bool>.Binding
    @ViewBuilder let content: () -> Content
    @State private var typed = ""

    var body: some View {
        content()
            .contentShape(Rectangle())
            .onTapGesture { isFocused.wrappedValue = true }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Type an amount")
            .background {
                TextField("Amount", text: $typed)
                    .keyboardType(.decimalPad)
                    .focused(isFocused)
                    .opacity(0)
                    .frame(width: 1, height: 1)
            }
            .onAppear { typed = text }
            .onChange(of: typed) { _, new in
                let accepted = onType(new)
                if accepted != new { typed = accepted }
            }
            .onChange(of: text) { _, new in if new != typed { typed = new } }
    }
}
