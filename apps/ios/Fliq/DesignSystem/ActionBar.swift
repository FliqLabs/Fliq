import SwiftUI

struct ActionBarItem: Identifiable {
    let title: String
    let symbol: String
    var isEnabled = true
    var isSelected = false
    /// The middle button: a bright disc that opens a menu instead of a tab.
    var isProminent = false
    let action: () -> Void

    var id: String { title }
}

/// The floating Home / move money / Activity bar, as one capsule of Liquid Glass.
struct ActionBar: View {
    let items: [ActionBarItem]

    var body: some View {
        FliqGlassContainer {
            HStack {
                ForEach(items) { item in
                    Button(action: item.action) {
                        Group {
                            if item.isProminent {
                                prominent(item)
                            } else {
                                tab(item)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.pressable)
                    .disabled(!item.isEnabled)
                    .accessibilityLabel(item.title)
                    .accessibilityAddTraits(item.isSelected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 76)
            .fliqGlass(Capsule(), interactive: true)
        }
    }

    private func tab(_ item: ActionBarItem) -> some View {
        VStack(spacing: 6) {
            Image(systemName: item.symbol)
                .font(.system(size: 20, weight: item.isSelected ? .semibold : .regular))
                .frame(height: 24)
            Text(item.title)
                .font(.system(size: 12, weight: item.isSelected ? .semibold : .regular))
        }
        .frame(maxWidth: .infinity, minHeight: 56)
        .background(item.isSelected ? Color.white.opacity(0.12) : .clear, in: Capsule())
        .foregroundStyle(item.isEnabled ? (item.isSelected ? Theme.textPrimary : Theme.textSecondary) : Theme.textDisabled)
    }

    private func prominent(_ item: ActionBarItem) -> some View {
        Image(systemName: item.symbol)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(.black)
            .frame(width: 58, height: 58)
            .background(.white, in: Circle())
            .shadow(color: .white.opacity(0.18), radius: 14)
    }
}
