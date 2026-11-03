import SwiftUI

/// The slow brand-colour mesh at the top of onboarding screens. The accent tints it by status:
/// green while a name is free, red when it is taken.
struct Aurora: View {
    var accent: Color?
    @State private var drift = false

    var body: some View {
        ZStack {
            blob(Color(hex: 0x1E2CFF).opacity(0.75), x: 0.22, y: 0.38, size: 260)
            blob(Color(hex: 0x7158FF).opacity(0.7), x: 0.7, y: 0.3, size: 300)
            blob(Color(hex: 0xC9AAFF).opacity(0.45), x: 0.52, y: 0.62, size: 240)
            if let accent {
                blob(accent.opacity(0.35), x: 0.85, y: 0.7, size: 220)
            }
        }
        .blur(radius: 58)
        .offset(x: drift ? -26 : 0, y: drift ? 14 : 0)
        .scaleEffect(drift ? 1.08 : 1)
        .frame(height: 520)
        .mask(LinearGradient(colors: [.black, .black.opacity(0.88), .clear], startPoint: .top, endPoint: .bottom))
        .frame(maxHeight: .infinity, alignment: .top)
        .offset(y: -120)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(.easeInOut(duration: 0.4), value: accent)
        .onAppear {
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
    }

    private func blob(_ color: Color, x: CGFloat, y: CGFloat, size: CGFloat) -> some View {
        GeometryReader { proxy in
            Ellipse()
                .fill(color)
                .frame(width: size, height: size * 0.75)
                .position(x: proxy.size.width * x, y: proxy.size.height * y)
        }
    }
}

/// The small rounded chip used for status and the Continue action on onboarding screens.
struct ChipLabel: View {
    let text: String
    var symbol: String?
    var color: Color = Theme.textPrimary
    var badge = false

    var body: some View {
        HStack(spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .symbolRenderingMode(badge ? .palette : .monochrome)
                    .foregroundStyle(badge ? Color.black : color, color)
            }
            Text(text)
        }
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(color)
        .padding(.horizontal, 14)
        .frame(height: 40)
        .fliqGlass(Capsule(), interactive: true)
    }
}
