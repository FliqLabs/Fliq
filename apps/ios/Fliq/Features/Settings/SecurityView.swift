import SwiftUI
import UIKit

struct SecurityView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Image(systemName: "person.badge.key")
                        .font(.system(size: 20))
                        .frame(width: 44, height: 44)
                        .background(Theme.surfaceRaised, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Passkey").font(.system(size: 15, weight: .medium))
                        Text("Created when sign-in goes live")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Pill(text: "Not yet", color: Theme.textSecondary, fill: Color(hex: 0x262626))
                }
                .padding(16)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(.top, 20)

                SectionLabel(text: "Sending").padding(.top, 20)
                VStack(spacing: 0) {
                    InfoRow(symbol: nil, title: "Face ID to send", value: "Always on")
                    InfoRow(symbol: nil, title: "Face ID for agents' limits", value: "Always on", isLast: true)
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                Text("Nothing leaves your vault, and no agent's limits change, without Face ID or your passcode.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 8)

                SectionLabel(text: "Devices").padding(.top, 20)
                VStack(spacing: 0) {
                    CardRow(isLast: true) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(UIDevice.current.name)
                            Text("This device · active now").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Circle().fill(Theme.confirmed).frame(width: 6, height: 6)
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(Theme.textPrimary)
            }
        }
        .scrollIndicators(.hidden)
        .fliqScreen("Security")
    }
}

struct Pill: View {
    let text: String
    var color: Color = Theme.confirmed
    var fill: Color = Color(hex: 0x0F2E19)

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(fill, in: Capsule())
    }
}
