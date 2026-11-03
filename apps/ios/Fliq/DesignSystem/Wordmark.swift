import SwiftUI

struct Wordmark: View {
    var size: CGFloat = 24

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("fl")
            Text("ı")
                .overlay(alignment: .top) {
                    Circle()
                        .fill(Theme.brand)
                        .frame(width: size * 0.27, height: size * 0.27)
                        .shadow(color: Color(hex: 0x5A50FF).opacity(0.55), radius: 3.5)
                        .offset(y: size * 0.06)
                }
            Text("q")
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .tracking(-0.02 * size)
        .foregroundStyle(Theme.textPrimary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("fliq")
    }
}

#Preview {
    Wordmark(size: 48)
        .padding()
        .background(.black)
}
