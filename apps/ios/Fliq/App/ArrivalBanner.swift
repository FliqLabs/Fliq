import SwiftUI

/// "$9.21 arrived": the moment a deposit lands, wherever the person is in the app.
struct ArrivalBanner: View {
    let amount: TokenAmount

    var body: some View {
        HStack(spacing: 10) {
            Icon("checkmark", size: 14)
                .foregroundStyle(.black)
                .frame(width: 24, height: 24)
                .background(Theme.confirmed, in: Circle())
            Text("$\(Money.dollars(amount)) arrived in your vault")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .monospacedDigit()
        }
        .padding(.leading, 10)
        .padding(.trailing, 16)
        .frame(height: 44)
        .fliqGlass(Capsule())
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
    }
}
