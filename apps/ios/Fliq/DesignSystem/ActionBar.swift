import SwiftUI

struct ActionBarItem: Identifiable {
    let title: String
    let symbol: String
    var isEnabled = true
    let action: () -> Void

    var id: String { title }
}

struct ActionBar: View {
    let items: [ActionBarItem]

    var body: some View {
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
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(item.isEnabled ? Theme.textPrimary : Theme.textDisabled)
                }
                .disabled(!item.isEnabled)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 76)
        .background(Theme.actionBar, in: Capsule())
    }
}
