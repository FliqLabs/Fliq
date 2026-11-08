import SwiftUI

struct ActionBarItem: Identifiable {
    let title: String
    let symbol: String
    var isEnabled = true
    var isSelected = false
    let action: () -> Void

    var id: String { title }
}

/// The floating Receive / Send / Request / Activity bar, as one capsule of Liquid Glass.
struct ActionBar: View {
    let items: [ActionBarItem]

    var body: some View {
        FliqGlassContainer {
            HStack {
                ForEach(items) { item in
                    Button(action: item.action) {
                        VStack(spacing: 6) {
                            Image(systemName: item.symbol)
                                .font(.system(size: 20, weight: .regular))
                                .frame(height: 24)
                            Text(item.title)
                                .font(.system(size: 12))
                        }
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(item.isSelected ? Color.white.opacity(0.12) : .clear, in: Capsule())
                        .contentShape(Rectangle())
                        .foregroundStyle(item.isEnabled ? Theme.textPrimary : Theme.textDisabled)
                    }
                    .buttonStyle(.pressable)
                    .disabled(!item.isEnabled)
                    .accessibilityAddTraits(item.isSelected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 76)
            .fliqGlass(Capsule(), interactive: true)
        }
    }
}
