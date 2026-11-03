import SwiftUI

/// Rules for typing a dollar amount on the keypad: one dot, two decimals, no leading zeros.
enum AmountTyping {
    static let delete = "⌫"
    static let maxLength = 9

    static func apply(_ key: String, to text: String) -> String {
        if key == delete { return String(text.dropLast()) }
        if key == "." && text.contains(".") { return text }
        if let dot = text.firstIndex(of: "."), text[dot...].count > 2 { return text }
        let next: String
        switch (text, key) {
        case ("", "."): next = "0."
        case ("0", _) where key != ".": next = key
        default: next = text + key
        }
        return next.count <= maxLength ? next : text
    }
}

/// The 3 by 4 number pad from App v5, used on Pay and Receive.
struct Keypad: View {
    let onKey: (String) -> Void

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", AmountTyping.delete]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 0) {
            ForEach(keys, id: \.self) { key in
                Button { onKey(key) } label: {
                    Group {
                        if key == AmountTyping.delete {
                            Image(systemName: "delete.left").font(.system(size: 22))
                        } else {
                            Text(key).font(.system(size: 26))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(Theme.textPrimary)
                .accessibilityLabel(key == AmountTyping.delete ? "Delete" : key)
            }
        }
        .padding(.vertical, 10)
        .background(Color(hex: 0x0A0A0A).ignoresSafeArea(edges: .bottom))
        .padding(.horizontal, -16)
    }
}
